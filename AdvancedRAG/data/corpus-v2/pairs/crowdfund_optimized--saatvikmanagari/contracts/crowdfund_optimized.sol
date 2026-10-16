// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

// OpenZeppelin
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CrowdFundOptimized — A gas-optimised decentralised crowdfunding contract
/// @notice Allows anyone to create fundraising campaigns, accept ETH contributions,
///         and either withdraw funds on success or claim a refund on failure.
/// @dev Inherits OpenZeppelin `Ownable` for contract-level admin access and
///      `ReentrancyGuard` to protect ETH transfer functions.
///
///      Gas optimisations over the base version:
///      - `campaignid` field removed — the mapping key already serves as the ID,
///        eliminating one 32-byte SSTORE (~20 k gas) per campaign.
///      - `metadataCID` storage removed — the CID is emitted in {CampaignCreated}
///        so off-chain indexers can recover it from logs at zero storage cost.
///      - `campaign_id_list` array removed — because IDs are sequential (0 … campaignCount-1),
///        `getAllCampaignIds` reconstructs the list in memory at query time,
///        saving ~20 k gas (new slot write + length update) on every `createCampaign`.
///      - Default zero-values for `amountcontributed` and `state` are relied upon
///        rather than written explicitly, avoiding redundant SSTOREs.
contract CrowdFundOptimized is Ownable, ReentrancyGuard {

    /// @notice Initialises the contract and sets the deployer as the owner.
    constructor() Ownable(msg.sender) {}

    /// @notice Lifecycle states a campaign can be in.
    /// @dev State transitions:
    ///      Active → Failed    (deadline passed, goal not met)
    ///      Active → Success   (deadline passed, goal met)
    ///      Success → Withdrawn (owner has pulled funds)
    ///      The enum starts at 0, so a freshly written struct defaults to `Active`
    ///      without an explicit SSTORE.
    enum status { Active, Failed, Success, Withdrawn }

    /// @notice Stores all on-chain data for a single campaign.
    /// @dev `campaignid` and `metadataCID` are intentionally omitted vs. the base
    ///      contract to reduce storage costs (see contract-level `@dev` note).
    ///      Per-contributor balances are tracked in a nested mapping, which prevents
    ///      the struct from being returned directly from a public getter.
    struct campaign {
        /// @dev Address of the campaign creator.
        address owner;
        /// @dev Current lifecycle state (defaults to `Active` == 0 on first write).
        status state;
        /// @dev Funding goal expressed in wei.
        uint goalWei;
        /// @dev Unix timestamp after which contributions are no longer accepted.
        uint deadlineTimestamp;
        /// @dev Running total of all contributions received, in wei
        ///      (defaults to 0 — no explicit initialisation needed).
        uint amountcontributed;
        /// @dev Maps each contributor's address to the total wei they have sent.
        mapping(address => uint) contributions;
    }

    /// @notice Maps a campaign ID to its `campaign` storage struct.
    /// @dev IDs are sequential integers starting at 0; the mapping key IS the ID,
    ///      so no separate `campaignid` field is stored inside the struct.
    mapping(uint => campaign) public campaign_map;

    /// @notice Total number of campaigns created; also determines the next campaign ID.
    /// @dev Campaign IDs are in the range [0, campaignCount).
    uint256 public campaignCount;

    // ── EVENTS ───────────────────────────────────────────────────────

    /// @notice Emitted when a new campaign is successfully created.
    /// @dev `metadataCID` is only emitted here (not stored on-chain) to save gas.
    ///      Off-chain indexers should listen for this event to index campaign metadata.
    /// @param campaign_id       The unique ID assigned to the new campaign.
    /// @param owner             Address of the campaign creator.
    /// @param goalWei           Funding goal in wei.
    /// @param deadlineTimestamp Unix timestamp of the campaign deadline.
    /// @param metadataCID       IPFS CID for off-chain campaign metadata.
    event CampaignCreated(uint campaign_id, address owner, uint goalWei, uint deadlineTimestamp, string metadataCID);

    /// @notice Emitted when a contributor sends ETH to a campaign.
    /// @param from   Address of the contributor.
    /// @param cmpgn  ID of the campaign that received the contribution.
    /// @param amount Amount contributed in wei.
    event Contributed(address from, uint cmpgn, uint amount);

    /// @notice Emitted when a campaign owner successfully withdraws raised funds.
    /// @param to          Address the funds were sent to (the campaign owner).
    /// @param campaign_id ID of the campaign from which funds were withdrawn.
    event FundsWithdrawn(address payable to, uint campaign_id);

    /// @notice Emitted when a contributor successfully claims a refund.
    /// @param to          Address the refund was sent to.
    /// @param campaign_id ID of the campaign from which the refund was issued.
    /// @param amount      Amount refunded in wei.
    event Refunded(address payable to, uint campaign_id, uint amount);

    // ── CREATE CAMPAIGN ──────────────────────────────────────────────

    /// @notice Creates a new crowdfunding campaign.
    /// @dev Increments `campaignCount` and uses the pre-increment value as the new ID.
    ///      Only `owner`, `goalWei`, and `deadlineTimestamp` are written to storage;
    ///      `state` and `amountcontributed` rely on their Solidity zero-value defaults.
    ///      `_metadataCID` is passed as `calldata` (never copied to memory) and emitted
    ///      in {CampaignCreated} rather than persisted in storage.
    ///      Emits {CampaignCreated}.
    /// @param _goalWei           Minimum wei that must be raised for the campaign to succeed.
    ///                           Must be greater than zero.
    /// @param _deadlineTimestamp Unix timestamp after which no more contributions are accepted.
    ///                           Must be strictly greater than the current block timestamp.
    /// @param _metadataCID       IPFS content identifier for off-chain metadata (title, description, image…).
    /// @return                   The ID assigned to the newly created campaign.
    function createCampaign(
        uint256 _goalWei,
        uint256 _deadlineTimestamp,
        string calldata _metadataCID
    ) external returns (uint) {
        require(_goalWei > 0, "Funds requested invalid");
        require(_deadlineTimestamp > block.timestamp, "Deadline invalid");

        uint256 campaign_id = campaignCount++;

        // No push to campaign_id_list, no campaignid field, no metadataCID storage.
        campaign storage newCampaign = campaign_map[campaign_id];
        newCampaign.owner             = msg.sender;
        newCampaign.goalWei           = _goalWei;
        newCampaign.deadlineTimestamp = _deadlineTimestamp;
        // amountcontributed defaults to 0 – explicit assignment removed (saves gas).
        // state defaults to status.Active (== 0) – explicit assignment removed.

        emit CampaignCreated(campaign_id, msg.sender, _goalWei, _deadlineTimestamp, _metadataCID);
        return campaign_id;
    }

    // ── CONTRIBUTE ───────────────────────────────────────────────────

    /// @notice Sends ETH to an active campaign as a contribution.
    /// @dev The full `msg.value` is credited to the caller's contribution balance.
    ///      The campaign owner is not permitted to contribute to their own campaign.
    ///      Emits {Contributed}.
    /// @param _campaignId ID of the campaign to fund.
    function contribute(uint256 _campaignId) external payable {
        campaign storage selected = campaign_map[_campaignId];

        require(selected.owner != address(0),                 "Campaign does not exist");
        require(selected.state == status.Active,               "Campaign not active");
        require(msg.sender != selected.owner,                  "Owner cannot contribute");
        require(block.timestamp < selected.deadlineTimestamp,  "Campaign expired");
        require(msg.value > 0,                                 "Invalid amount");

        selected.contributions[msg.sender] += msg.value;
        selected.amountcontributed         += msg.value;

        emit Contributed(msg.sender, _campaignId, msg.value);
    }

    // ── WITHDRAW ─────────────────────────────────────────────────────

    /// @notice Allows the campaign owner to withdraw all raised funds after a successful campaign.
    /// @dev The redundant `block.timestamp >= deadlineTimestamp` guard inside the `if`
    ///      block from the base contract is removed — it is already enforced by the
    ///      `require` above, so the condition here only needs to check the goal.
    ///      Sets `amountcontributed` to zero and transitions state to `Withdrawn` before
    ///      the external call (checks-effects-interactions), alongside `nonReentrant`.
    ///      Emits {FundsWithdrawn}.
    /// @param _campaignId ID of the campaign whose funds should be withdrawn.
    function withdraw(uint256 _campaignId) external nonReentrant {
        campaign storage selected = campaign_map[_campaignId];

        require(msg.sender == selected.owner,                   "Only owner can withdraw");
        require(block.timestamp >= selected.deadlineTimestamp,  "Campaign ongoing");
        require(selected.state != status.Withdrawn,             "Campaign already withdrawn");

        if (selected.amountcontributed >= selected.goalWei) {
            selected.state = status.Success;
        }

        require(selected.state == status.Success, "Campaign not successful");

        uint amount = selected.amountcontributed;
        selected.amountcontributed = 0;
        selected.state = status.Withdrawn;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit FundsWithdrawn(payable(msg.sender), _campaignId);
    }

    // ── REFUND ───────────────────────────────────────────────────────

    /// @notice Allows a contributor to reclaim their ETH after a failed campaign.
    /// @dev A campaign is considered failed when the deadline has passed and the goal
    ///      was not reached. Clears the caller's contribution balance before the external
    ///      call to guard against reentrancy (checks-effects-interactions),
    ///      alongside the `nonReentrant` modifier.
    ///      Emits {Refunded}.
    /// @param _campaignId ID of the campaign from which the refund is requested.
    function refund(uint _campaignId) external nonReentrant {
        campaign storage selected = campaign_map[_campaignId];

        require(msg.sender != selected.owner,                   "Owner cannot get a Refund");
        require(block.timestamp > selected.deadlineTimestamp,   "Campaign still active");

        if (selected.amountcontributed < selected.goalWei) {
            selected.state = status.Failed;
        }

        require(selected.state == status.Failed,                "Campaign was Successful");

        uint contributed = selected.contributions[msg.sender];
        require(contributed > 0,                                "Only contributors can get a refund");

        selected.contributions[msg.sender] = 0;
        selected.amountcontributed        -= contributed;

        (bool success, ) = payable(msg.sender).call{value: contributed}("");
        require(success, "Refund failed");

        emit Refunded(payable(msg.sender), _campaignId, contributed);
    }

    // ── READ ─────────────────────────────────────────────────────────

    /// @notice Returns the core on-chain details of a campaign.
    /// @dev `metadataCID` is no longer stored on-chain; retrieve it by querying the
    ///      {CampaignCreated} event log filtered by `campaign_id`.
    ///      Reverts if no campaign exists at `_campaignId` (owner is the zero address).
    /// @param _campaignId ID of the campaign to query.
    /// @return goal     Funding goal in wei.
    /// @return raised   Total wei contributed so far.
    /// @return deadline Unix timestamp of the campaign deadline.
    /// @return creator  Address of the campaign owner.
    /// @return state    Current lifecycle state of the campaign.
    function getCampaign(uint _campaignId) external view
        returns (
            uint goal,
            uint raised,
            uint deadline,
            address creator,
            status state
        )
    {
        campaign storage c = campaign_map[_campaignId];
        require(c.owner != address(0), "Campaign does not exist");
        return (
            c.goalWei,
            c.amountcontributed,
            c.deadlineTimestamp,
            c.owner,
            c.state
        );
    }

    /// @notice Returns the total wei contributed to a campaign by a specific address.
    /// @param _campaignId  ID of the campaign to query.
    /// @param contributor  Address of the contributor to look up.
    /// @return             Total wei contributed by `contributor` to the given campaign.
    function getContribution(uint _campaignId, address contributor) external view
        returns (uint)
    {
        campaign storage c = campaign_map[_campaignId];
        require(c.owner != address(0), "Campaign does not exist");
        return c.contributions[contributor];
    }

    /// @notice Returns all campaign IDs that have ever been created.
    /// @dev Because IDs are sequential integers in [0, campaignCount), the array is
    ///      constructed in memory at query time rather than read from a storage array,
    ///      saving ~20 k gas per `createCampaign` call vs. the base contract.
    ///      The `unchecked` block is safe here because `i` is bounded by `count`.
    /// @return An array of campaign IDs in creation order.
    function getAllCampaignIds() external view returns (uint[] memory) {
        uint count = campaignCount;
        uint[] memory ids = new uint[](count);
        for (uint i = 0; i < count; ) {
            ids[i] = i;
            unchecked { ++i; }
        }
        return ids;
    }

    // ── FALLBACKS ────────────────────────────────────────────────────

    /// @notice Accepts plain ETH transfers sent directly to the contract.
    receive() external payable {}

    /// @notice Reverts any call that does not match a valid function signature.
    /// @dev Prevents accidental ETH loss from miscoded calls.
    fallback() external payable {
        revert("Invalid call. Use contribute()");
    }
}
