// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title CognisTokenV2 ($CGOX)
 * @notice Plain, non-upgradeable, ownerless ERC-20 for the Cognis Protocol network.
 *
 * Design rules (v2), deliberately boring:
 *  - Fixed supply. The entire MAX_SUPPLY is minted once, in the constructor.
 *    There is no `mint` function; total supply can only ever go down (via burn).
 *  - No fee on transfer, no burn on transfer, no rebase, no reflection.
 *    `transfer(x)` moves exactly `x`. v1 charged 1% on every transfer, which
 *    silently broke escrow accounting and is incompatible with most AMMs and
 *    aggregators. That behaviour is removed here; the 1% burn + 1% treasury fee
 *    now lives in the settlement layer (CognisTribunalV2) where it is explicit.
 *  - No pause, no blacklist, no allowlist, no transfer hooks, no proxy.
 *  - `burn` / `burnFrom` are inherited from ERC20Burnable and are open to every
 *    holder. CognisTribunalV2 uses `burn` to destroy the protocol fee.
 *  - `permit` (EIP-2612) is supported so agents can approve without holding ETH.
 *
 * Ownership: there is none. The contract inherits no access-control module, has
 * no `owner`, no admin function and no privileged address of any kind. Once
 * deployed its behaviour is fixed forever: nobody can mint, pause, freeze,
 * blacklist, upgrade, rescue or otherwise touch anyone's balance. Any future
 * extension has to be a separate contract that holders opt into by approving it.
 *
 * Distribution (minted at deployment, no lockup logic inside the token):
 *   55%  Network Growth Reserve      -> multi-sig
 *   25%  Liquidity & Operations      -> multi-sig
 *   20%  Founder                     -> CognisFounderVesting (linear vesting)
 *
 * This is a utility token for a peer-to-peer agent network. It is not a share,
 * it carries no claim on anyone's assets or revenue, and no return of any kind
 * is offered or implied.
 */
contract CognisTokenV2 is ERC20, ERC20Burnable, ERC20Permit {
    /// @notice Total supply minted at deployment. Never increases.
    uint256 public constant MAX_SUPPLY = 1_000_000_000e18;

    /// @notice 55% of MAX_SUPPLY.
    uint256 public constant RESERVE_ALLOCATION = 550_000_000e18;
    /// @notice 25% of MAX_SUPPLY.
    uint256 public constant OPERATIONS_ALLOCATION = 250_000_000e18;
    /// @notice 20% of MAX_SUPPLY. RESERVE + OPERATIONS + FOUNDER == MAX_SUPPLY.
    uint256 public constant FOUNDER_ALLOCATION = 200_000_000e18;

    /// @notice Network Growth Reserve holder recorded at deployment (informational).
    address public immutable reserve;
    /// @notice Liquidity & Operations holder recorded at deployment (informational).
    address public immutable operations;
    /// @notice Founder vesting contract recorded at deployment (informational).
    address public immutable founderVesting;

    error ZeroAddress();
    error DuplicateAllocationTarget();

    event AllocationMinted(
        address indexed reserve,
        address indexed operations,
        address indexed founderVesting,
        uint256 reserveAmount,
        uint256 operationsAmount,
        uint256 founderAmount
    );

    /**
     * @param reserve_        Network Growth Reserve recipient (multi-sig).
     * @param operations_     Liquidity & Operations recipient (multi-sig).
     * @param founderVesting_ Founder vesting contract (see CognisFounderVesting).
     */
    constructor(address reserve_, address operations_, address founderVesting_)
        ERC20("Cognis Protocol", "CGOX")
        ERC20Permit("Cognis Protocol")
    {
        if (reserve_ == address(0) || operations_ == address(0) || founderVesting_ == address(0)) {
            revert ZeroAddress();
        }
        if (reserve_ == operations_ || reserve_ == founderVesting_ || operations_ == founderVesting_) {
            revert DuplicateAllocationTarget();
        }

        reserve = reserve_;
        operations = operations_;
        founderVesting = founderVesting_;

        // The three constants are literals that sum to exactly MAX_SUPPLY,
        // so the whole supply exists after these three mints and never changes.
        _mint(reserve_, RESERVE_ALLOCATION);
        _mint(operations_, OPERATIONS_ALLOCATION);
        _mint(founderVesting_, FOUNDER_ALLOCATION);

        emit AllocationMinted(
            reserve_, operations_, founderVesting_, RESERVE_ALLOCATION, OPERATIONS_ALLOCATION, FOUNDER_ALLOCATION
        );
    }
}
