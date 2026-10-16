# jack-vesting--jacktokenproject

- domain: vesting-timelock (vesting)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/JackTokenProject/JackVesting @ 857354b633b663a90d6e3cd39260f05e15c87948
- license: MIT
- targets: JackVesting.sol, JackToken.sol
- validation: 7 passing tests, 0 failing; statement coverage JackVesting.sol 100.0 %, JackToken.sol 100.0 %

## Contract: JackToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";




contract JACK is ERC20, Ownable2Step {
    error MaxSupplyExceeded();
    error OperationNotAllowed();

    uint256 constant public maxSupply = 1_000_000_000 ether;

    constructor() ERC20("JACK Token", "JACK") Ownable(msg.sender) {}

    function mint(address to, uint256 amount) public onlyOwner {
        if (totalSupply() + amount > maxSupply) {
            revert MaxSupplyExceeded();
        }
        _mint(to, amount);
    }

    function renounceOwnership() public virtual override onlyOwner {
        revert OperationNotAllowed();
    }
}
```

## Contract: JackVesting.sol (primary target)

```solidity
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
```

## Tests: JackVesting.js

```javascript
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("JackVesting", function () {
    let owner;
    let jackToken;
    let jackVesting;

    beforeEach(async function () {
        [owner] = await ethers.getSigners();
        jackToken = await ethers.deployContract("JACK");

        jackVesting = await ethers.deployContract("JackVesting", [
            jackToken.target,
        ]);
    });

    it("Add vesting Success", async function () {

        await jackToken.approve(
            jackVesting.target,
            ethers.parseUnits("10000", "ether")
        );

        await jackToken.mint(
            owner.address,
            ethers.parseUnits("10000", "ether")
        );

        //1 hour from now
        let until = parseInt(new Date().valueOf() / 1000 + 3600);

        await expect(
            jackVesting.addVesting(
                owner.address,
                ethers.parseUnits("10000", "ether"),
                until,
                0
            )
        ).to.not.be.reverted;
    });

    it("Add vesting Error not approved", async function () {
        //1 hour from now
        let until = parseInt(new Date().valueOf() / 1000 + 3600);

        await expect(
            jackVesting.addVesting(
                owner.address,
                ethers.parseUnits("10000", "ether"),
                until,
                0
            )
        ).to.be.reverted;
    });

    it("Add vesting Error balance", async function () {
        await jackToken.approve(
            jackVesting.target,
            ethers.parseUnits("10000", "ether")
        );

        await jackToken.mint(owner.address, ethers.parseUnits("1000", "ether"));

        //1 hour from now
        let until = parseInt(new Date().valueOf() / 1000 + 3600);

        await expect(
            jackVesting.addVesting(
                owner.address,
                ethers.parseUnits("10000", "ether"),
                until,
                0
            )
        ).to.be.reverted;
    });

    it("Claim vesting  Error Locked", async function () {

        await jackToken.approve(
            jackVesting.target,
            ethers.parseUnits("10000", "ether")
        );

        await jackToken.mint(
            owner.address,
            ethers.parseUnits("10000", "ether")
        );

        //1 hour from now
        let until = parseInt(parseInt(new Date().valueOf() / 1000 + 3600));
        await jackVesting.addVesting(
            owner.address,
            ethers.parseUnits("10000", "ether"),
            until,
            0
        );

        await expect(jackVesting.claim(0)).to.be.reverted;
    });

    it("Claim vesting  Error Index", async function () {

        await jackToken.approve(
            jackVesting.target,
            ethers.parseUnits("10000", "ether")
        );

        await jackToken.mint(
            owner.address,
            ethers.parseUnits("10000", "ether")
        );

        //1 hour from now
        let until = parseInt(parseInt(new Date().valueOf() / 1000 + 3600));
        await jackVesting.addVesting(
            owner.address,
            ethers.parseUnits("10000", "ether"),
            until,
            0
        );

        await expect(jackVesting.claim(1)).to.be.reverted;
    });

    it("Claim vesting Error Allredy claimed", async function () {
        await jackToken.approve(
            jackVesting.target,
            ethers.parseUnits("10000", "ether")
        );

        await jackToken.mint(
            owner.address,
            ethers.parseUnits("10000", "ether")
        );

        //1 hour from now
        let until = parseInt(parseInt(new Date().valueOf() / 1000 + 3600));
        await jackVesting.addVesting(
            owner.address,
            ethers.parseUnits("10000", "ether"),
            until,
            0
        );
        await time.increaseTo(parseInt(new Date().valueOf() / 1000 + 3601));
        await jackVesting.claim(0);
        await expect(jackVesting.claim(0)).to.be.reverted;
    });

    it("Claim vesting", async function () {

        await jackToken.approve(
            jackVesting.target,
            ethers.parseUnits("10000", "ether")
        );

        await jackToken.mint(
            owner.address,
            ethers.parseUnits("10000", "ether")
        );

        //1 hour from now
        let until = parseInt(parseInt(new Date().valueOf() / 1000 + 13600));
        await jackVesting.addVesting(
            owner.address,
            ethers.parseUnits("10000", "ether"),
            until,
            0
        );

        await time.increaseTo(parseInt(new Date().valueOf() / 1000 + 13601));
        await expect(jackVesting.claim(0)).to.not.be.reverted;
    });
});
```
