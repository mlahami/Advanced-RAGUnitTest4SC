// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract JackVesting is Context, Ownable2Step {
    error TransferError(address sender, uint256 needed);
    error InvalidVestingIndex();
    error InvalidVestingAddress();
    error AllreadyClaimed();
    error Locked();
    error InvalidBeneficiary();
    error AmountError();
    error InvalidVestingTime();

    event VestingAdded(
        address indexed _beneficiary,
        uint256 _amount,
        uint80 _until,
        uint256 _source
    );

    struct Vesting {
        uint80 until;
        bool claimed;
        uint256 source;
        uint256 amount;
    }
    mapping(address vesting => Vesting[]) public vestings;

    IERC20 public immutable vestingToken;

    uint256 public constant maxVestingTime = 3 * 365 days;

    constructor(IERC20 _vestingToken) Ownable(msg.sender) {
        if(address(_vestingToken) == address(0)){
            revert InvalidVestingAddress();
        }
        vestingToken = _vestingToken;
    }

    function addVesting(
        address _beneficiary,
        uint256 _amount,
        uint80 _until,
        uint256 _source
    ) public onlyOwner returns (bool) {
        if (_beneficiary == address(0)) {
            revert InvalidBeneficiary();
        }
        if (_amount == 0) {
            revert AmountError();
        }
        if (
            _until > block.timestamp + maxVestingTime ||
            _until <= block.timestamp
        ) {
            revert InvalidVestingTime();
        }

        address sender = _msgSender();
        vestings[_beneficiary].push(
            Vesting({
                until: _until,
                amount: _amount,
                claimed: false,
                source: _source
            })
        );

        uint256 balanceBefore = vestingToken.balanceOf(address(this));

        SafeERC20.safeTransferFrom(
            vestingToken,
            sender,
            address(this),
            _amount
        );

        uint256 transferedAmount = vestingToken.balanceOf(address(this)) -
            balanceBefore;

        if (transferedAmount != _amount) {
            revert TransferError(sender, _amount);
        }

        emit VestingAdded(_beneficiary, _amount, _until, _source);

        return true;
    }

    function claim(uint index) external {
        address sender = _msgSender();
        if (vestings[sender].length <= index) {
            revert InvalidVestingIndex();
        }
        if (vestings[sender][index].claimed) {
            revert AllreadyClaimed();
        }

        if (vestings[sender][index].until > block.timestamp) {
            revert Locked();
        }

        vestings[sender][index].claimed = true;
        SafeERC20.safeTransfer(
            vestingToken,
            sender,
            vestings[sender][index].amount
        );
    }

    function renounceOwnership() public virtual override onlyOwner {
        revert OwnableInvalidOwner(address(0));
    }
}
