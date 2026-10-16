// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// OpenZeppelin imports:
// - SafeERC20: wraps ERC-20 calls so they revert cleanly on failure
// - IERC20: standard interface for interacting with any ERC-20 token (like DOC)
// - ReentrancyGuard: prevents reentrancy attacks on withdrawal functions
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  DOCVesting
 * @author Michael Mushunje
 * @notice A time-locked vesting vault for DOC tokens on Rootstock (RSK).
 *
 *         HOW IT WORKS:
 *         1. Admin deploys the contract and funds it with DOC tokens.
 *         2. Admin sets a beneficiary with a total allocation and vesting schedule.
 *         3. Tokens unlock linearly over time, with an optional cliff period
 *            during which no withdrawals are allowed at all.
 *         4. The beneficiary can withdraw at any time after the cliff:
 *            - Within the vested amount  → no penalty, full amount received.
 *            - Beyond the vested amount  → 20% penalty on the unvested excess.
 *              The penalty stays in the contract.
 *
 *         STATE MACHINE:
 *         The vault moves through three logical states:
 *
 *           NOT_CONFIGURED  → contract deployed, no beneficiary yet
 *           LOCKED          → before cliff ends, no withdrawals allowed
 *           VESTING         → cliff passed, tokens unlocking linearly
 *           COMPLETE        → vesting period over, all tokens available penalty-free
 */
contract DOCVesting is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// @notice Penalty rate applied to unvested excess withdrawals (20%)
    uint256 public constant PENALTY_RATE = 20;

    /// @notice Divisor used with PENALTY_RATE: penalty = unvestedExcess * 20 / 100
    uint256 public constant PERCENT_BASE = 100;

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    /// @notice The wallet that deployed and manages this contract
    /// @dev    Immutable — set once in constructor, saves gas on every read
    address public immutable admin;

    /// @notice The DOC ERC-20 token contract on Rootstock
    /// @dev    Immutable for the same reason as admin
    IERC20 public immutable docToken;

    /// @notice The wallet that will receive the vested tokens
    address public beneficiary;

    /// @notice Total DOC tokens allocated to the beneficiary
    uint256 public totalAllocation;

    /// @notice How long the full vesting lasts in seconds (e.g. 180 days = 15552000)
    uint256 public vestingPeriod;

    /**
     * @notice Optional delay before ANY withdrawal is allowed (LOCKED state).
     *         Set to 0 if no cliff is needed.
     * @dev    Must always be shorter than vestingPeriod.
     */
    uint256 public cliffPeriod;

    /// @notice Block timestamp when the beneficiary was set up — vesting clock starts here
    uint256 public startTime;

    /**
     * @notice Running total of DOC already withdrawn by the beneficiary.
     * @dev    Tracks the FULL requested amount, including any penalised portion.
     *         This prevents a beneficiary from re-withdrawing tokens that were
     *         already consumed as a penalty in a previous early withdrawal.
     */
    uint256 public withdrawn;

    /// @notice Accumulated penalties from early withdrawals — stays in contract
    uint256 public penaltyPool;

    /// @notice Prevents setup() from being called more than once
    bool public isConfigured;

    // =========================================================================
    // EVENTS
    // =========================================================================

    // Events are the contract's on-chain log. They cost minimal gas and allow
    // frontends, block explorers, and auditors to track everything that happens.

    /// @notice Fired when admin deposits DOC into the contract
    event ContractFunded(address indexed funder, uint256 amount);

    /// @notice Fired when the beneficiary and schedule are configured
    event BeneficiarySet(
        address indexed wallet,
        uint256 allocation,
        uint256 vestingPeriod,
        uint256 cliffPeriod,
        uint256 startTime
    );

    /**
     * @notice Fired on every successful withdrawal
     * @param amountReceived  What the beneficiary actually got after any penalty
     * @param penaltyPaid     How much was deducted (0 if no penalty applied)
     * @param state           Vault state at the time of withdrawal
     */
    event Withdrawal(
        address indexed beneficiary,
        uint256 amountReceived,
        uint256 penaltyPaid,
        string state
    );

    // =========================================================================
    // MODIFIERS
    // =========================================================================

    /// @dev Blocks anyone except the admin from calling the function
    modifier onlyAdmin() {
        require(msg.sender == admin, "Caller is not admin");
        _;
    }

    /// @dev Blocks anyone except the beneficiary from calling the function
    modifier onlyBeneficiary() {
        require(msg.sender == beneficiary, "Caller is not beneficiary");
        _;
    }

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    /**
     * @notice Deploys the vault. Sets the admin and the DOC token address.
     *         No beneficiary is configured here — that happens via setup().
     *
     * @param _docToken  DOC token address on Rootstock testnet:
     *                   0xCB46c0ddc60D18eFEB0E586C17Af6ea36452Dae0
     */
    constructor(address _docToken) {
        require(_docToken != address(0), "Invalid token address");
        admin    = msg.sender;
        docToken = IERC20(_docToken);
    }

    // =========================================================================
    // ADMIN FUNCTIONS
    // =========================================================================

    /**
     * @notice Step 1 — Admin deposits DOC into the vault before setting up
     *         a beneficiary. Funding first ensures every allocation is backed
     *         by real tokens from the moment the beneficiary is added.
     *
     * @dev    Admin must call DOC.approve(address(this), amount) on the DOC
     *         token contract before calling this — otherwise transferFrom fails.
     *
     * @param amount  How many DOC tokens to deposit (in wei, 18 decimals)
     */
    function fundContract(uint256 amount) external onlyAdmin {
        require(amount > 0, "Amount must be greater than zero");

        // Pulls DOC from admin's wallet into this contract.
        // safeTransferFrom reverts automatically if the transfer fails for any reason.
        docToken.safeTransferFrom(msg.sender, address(this), amount);

        emit ContractFunded(msg.sender, amount);
    }

    /**
     * @notice Step 2 — Admin sets the beneficiary, their total allocation,
     *         and the vesting schedule. Can only ever be called once.
     *
     *         The contract checks that the vault already holds enough DOC to
     *         cover the allocation before accepting the configuration.
     *
     * @param _beneficiary   Wallet that will receive tokens over time
     * @param _allocation    Total DOC tokens reserved for them (in wei)
     * @param _vestingPeriod How long full vesting takes (in seconds)
     * @param _cliffPeriod   Seconds before first withdrawal allowed (0 = no cliff)
     */
    function setup(
        address _beneficiary,
        uint256 _allocation,
        uint256 _vestingPeriod,
        uint256 _cliffPeriod
    ) external onlyAdmin {

        // --- Checks ---

        require(!isConfigured,                "Beneficiary already configured");
        require(_beneficiary != address(0),   "Zero address not allowed");
        require(_beneficiary != address(this),"Cannot vest to contract itself");
        require(_beneficiary != admin,         "Admin cannot be beneficiary");
        require(_allocation > 0,              "Allocation must be greater than zero");
        require(_vestingPeriod > 0,           "Vesting period must be greater than zero");
        require(_cliffPeriod < _vestingPeriod, "Cliff must be shorter than vesting period");

        // Ensure vault is funded enough to cover this allocation.
        // This is the key guard that ties promises to real balances.
        uint256 contractBalance = docToken.balanceOf(address(this));
        require(contractBalance >= _allocation, "Fund the contract before setup");

        // --- Effects ---

        beneficiary     = _beneficiary;
        totalAllocation = _allocation;
        vestingPeriod   = _vestingPeriod;
        cliffPeriod     = _cliffPeriod;
        startTime       = block.timestamp;  // Vesting clock starts now
        isConfigured    = true;

        emit BeneficiarySet(
            _beneficiary,
            _allocation,
            _vestingPeriod,
            _cliffPeriod,
            block.timestamp
        );
    }

    // =========================================================================
    // BENEFICIARY FUNCTIONS
    // =========================================================================

    /**
     * @notice Withdraw DOC from the vault.
     *
     *         FOUR POSSIBLE OUTCOMES:
     *
     *         1. LOCKED (before cliff ends)
     *            → Reverts. No tokens transferred.
     *
     *         2. VESTING, amount ≤ vested portion
     *            → Normal withdrawal. Full amount received, zero penalty.
     *
     *         3. VESTING, amount > vested portion (early exit)
     *            → Penalty = 20% of the unvested excess being pulled early.
     *            → Beneficiary receives (amount - penalty).
     *            → Penalty accumulates in penaltyPool inside the contract.
     *
     *         4. COMPLETE (after vesting period ends)
     *            → All remaining tokens available. No penalty ever applies.
     *
     * @dev    Follows checks-effects-interactions (CEI) pattern:
     *            1. All require() checks run first
     *            2. State variables updated
     *            3. Token transfer called last
     *         This ordering prevents reentrancy even alongside ReentrancyGuard.
     *
     * @param amount  How many DOC tokens to withdraw (in wei)
     */
    function withdraw(uint256 amount) external onlyBeneficiary nonReentrant {

        // --- Checks ---

        require(isConfigured, "Vault not configured yet");
        require(amount > 0,   "Amount must be greater than zero");

        // LOCKED state — cliff has not passed, no withdrawals permitted at all
        require(
            block.timestamp >= startTime + cliffPeriod,
            "Cliff period has not passed yet"
        );

        // Cannot withdraw more than what remains of the total allocation
        uint256 remaining = totalAllocation - withdrawn;
        require(amount <= remaining, "Exceeds remaining allocation");

        // How much has vested so far based on time elapsed
        uint256 vested          = vestedAmount();

        // How much is available right now without any penalty
        // (vested so far, minus what has already been withdrawn)
        uint256 withdrawableNow = vested - withdrawn;

        // --- Determine which path this withdrawal takes ---

        uint256 penalty        = 0;
        uint256 actualReceived = amount;
        string memory state;

        if (block.timestamp >= startTime + vestingPeriod) {
            // COMPLETE — fully vested, penalty never applies
            state = "COMPLETE";

        } else if (amount <= withdrawableNow) {
            // VESTING — within vested portion, no penalty
            state = "VESTING";

        } else {
            // EARLY EXIT — requesting beyond what has vested, penalty applies
            // Only the unvested excess is penalised, not the whole amount
            state = "EARLY_EXIT";

            uint256 unvestedExcess = amount - withdrawableNow;
            penalty        = (unvestedExcess * PENALTY_RATE) / PERCENT_BASE;
            actualReceived = amount - penalty;
        }

        // --- Effects (state updates BEFORE transfer — CEI pattern) ---

        // Record the full requested amount as withdrawn, not just what was received.
        // This prevents re-claiming the penalised portion in a future withdrawal.
        withdrawn   += amount;
        penaltyPool += penalty;

        // --- Interaction (token transfer is always last) ---

        docToken.safeTransfer(msg.sender, actualReceived);

        emit Withdrawal(msg.sender, actualReceived, penalty, state);
    }

    // =========================================================================
    // VIEW FUNCTIONS  (read-only, zero gas when called externally)
    // =========================================================================

    /**
     * @notice How much DOC has vested for the beneficiary at this moment.
     *
     *         LINEAR VESTING formula:
     *         vestedAmount = totalAllocation × (elapsed / vestingPeriod)
     *
     *         Important: the cliff does NOT pause vesting — the clock always
     *         runs from startTime. The cliff only blocks the withdraw() call.
     *         When the cliff ends the beneficiary can claim everything vested
     *         since day one in a single transaction.
     *
     * @return Amount of DOC vested so far (in wei)
     */
    function vestedAmount() public view returns (uint256) {
        if (!isConfigured) return 0;

        uint256 elapsed = block.timestamp - startTime;

        // Past or at the end of vesting — everything is vested
        if (elapsed >= vestingPeriod) {
            return totalAllocation;
        }

        // Linear proportion: tokens unlock smoothly second by second
        return (totalAllocation * elapsed) / vestingPeriod;
    }

    /**
     * @notice Returns the current logical state of the vault as a string.
     *         Useful for frontends and for demonstrating state machine behaviour.
     *
     * @return One of: "NOT_CONFIGURED", "LOCKED", "VESTING", "COMPLETE"
     */
    function vaultState() public view returns (string memory) {
        if (!isConfigured)                                return "NOT_CONFIGURED";
        if (block.timestamp < startTime + cliffPeriod)   return "LOCKED";
        if (block.timestamp < startTime + vestingPeriod) return "VESTING";
        return "COMPLETE";
    }

    /**
     * @notice Preview the outcome of a withdrawal without sending a transaction.
     *         Call this from a frontend to show the beneficiary their numbers
     *         before they confirm — costs zero gas.
     *
     * @param  amount          The amount the beneficiary intends to withdraw
     * @return penalty         How much would be deducted as penalty
     * @return actualReceived  How much they would actually receive
     */
    function previewWithdrawal(uint256 amount)
        external
        view
        returns (uint256 penalty, uint256 actualReceived)
    {
        if (!isConfigured) return (0, 0);

        uint256 vested          = vestedAmount();
        uint256 withdrawableNow = vested > withdrawn ? vested - withdrawn : 0;

        if (amount <= withdrawableNow) {
            return (0, amount);
        }

        uint256 unvestedExcess = amount - withdrawableNow;
        penalty        = (unvestedExcess * PENALTY_RATE) / PERCENT_BASE;
        actualReceived = amount - penalty;
    }

    /**
     * @notice Full snapshot of the vault — one call for everything.
     *         Useful for dashboards and capstone demos.
     *
     * @return state             Current vault state string
     * @return _totalAllocation  Total DOC allocated to beneficiary
     * @return _withdrawn        Total already withdrawn (including penalised amounts)
     * @return vested            How much has vested so far
     * @return withdrawableNow   Available right now without any penalty
     * @return _penaltyPool      Total penalties accumulated in the contract
     * @return cliffPassedAt     Timestamp when cliff ends (or ended)
     * @return fullyVestedAt     Timestamp when vesting completes
     */
    function getVaultStatus()
        external
        view
        returns (
            string memory state,
            uint256 _totalAllocation,
            uint256 _withdrawn,
            uint256 vested,
            uint256 withdrawableNow,
            uint256 _penaltyPool,
            uint256 cliffPassedAt,
            uint256 fullyVestedAt
        )
    {
        uint256 v         = vestedAmount();
        uint256 available = v > withdrawn ? v - withdrawn : 0;

        return (
            vaultState(),
            totalAllocation,
            withdrawn,
            v,
            available,
            penaltyPool,
            startTime + cliffPeriod,
            startTime + vestingPeriod
        );
    }
}