// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ILeashSpender {
    function spend(bytes32 leashId, uint256 amount, address to) external;
}

/// @notice Malicious ERC20 whose transferFrom re-enters LeashManager.spend.
///         Exists to prove the ReentrancyGuard + effects-first ordering hold.
///         Test suite only.
contract ReentrantToken is ERC20 {
    // Named attackTarget, not target: a public `target` getter collides with
    // ethers' BaseContract.target in the generated TypeChain types.
    ILeashSpender public attackTarget;
    bytes32 public leashId;
    bool private _armed;

    constructor() ERC20("Reentrant", "EVIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(ILeashSpender target_, bytes32 leashId_) external {
        attackTarget = target_;
        leashId = leashId_;
        _armed = true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (_armed) {
            _armed = false; // one re-entry attempt, then behave
            attackTarget.spend(leashId, amount, to);
        }
        return super.transferFrom(from, to, amount);
    }
}
