# fiduciary-duty--laprop

- domain: relayer-meta-transactions (meta-transactions)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/LaProp/contracts @ 0aaf375151ace3569b42994142cad8de692ad324
- license: MIT
- targets: FiduciaryDuty.sol, IERC3009Partial.sol, IWhiteList.sol, MockERC3009.sol, MockForwarder.sol, WhiteList.sol
- validation: 31 passing tests, 0 failing; statement coverage FiduciaryDuty.sol 87.76 %, IERC3009Partial.sol 100.0 %, IWhiteList.sol 100.0 %, MockERC3009.sol 84.62 %, MockForwarder.sol 0.0 %, WhiteList.sol 59.09 %

## Contract: FiduciaryDuty.sol (primary target)

```solidity
// SPDX-License-Identifier: LaProp proprietary license

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

import "./IWhiteList.sol";
import "./IERC3009Partial.sol";

contract FiduciaryDuty is ERC2771Context, ERC20, Ownable {

    error SenderNotWhitelisted(address sender);
    error BeneficiaryNotWhitelisted(address beneficiary);
    error RaiseCanceled();
    error InvalidValue(uint256 provided, uint256 expected);
    error InsufficientBalance(address account, uint256 available, uint256 required);
    error InvalidTransferDestination();
    error InvalidUnitAmount();
    error ExceedsAvailableSupply();
    error ViablePointNotReached();
    error ViablePointAlreadyReached();
    error NoRefundAvailable();
    error UnauthorizedAccess(address caller);
    error ContractPaused();
    error InvalidSignature();
    error TransferAuthorizationExpired();
    error TransferAuthorizationNotYetValid();
    error NonceAlreadyUsed();

    modifier onlyWhiteListed(address beneficiary) {
        IWhiteList whiteList = IWhiteList(_whiteListContract);
        if (!whiteList.isAddressWhiteListed(_msgSender())) {
            revert SenderNotWhitelisted(_msgSender());
        }
        if (beneficiary != _msgSender()) {
            if (!whiteList.isAddressWhiteListed(beneficiary)) {
                revert BeneficiaryNotWhitelisted(beneficiary);
            }
        }
        _;
    }

    struct Permission {
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    address private _tokenStorageAddress;
    address private _managerAddress;
    address private _whiteListContract;
    uint private _sold = 0;
    bool private _viablePoint = false;
    bool private _canceledRaise = false;
    uint256 private _minimal;
    uint256 private _unit;

    event PaymentReceived(address indexed from, uint256 amount, uint256 tokens);
    event PaymentReturned(address indexed to, uint256 amount);
    event DutyWithdrawn(address indexed to, uint256 amount);
    event RaiseEnded(bool canceled);

    constructor(
        address storageCrowdToken,
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address initialManager,
        address whiteListAddress,
        address trustedForwarder,
        uint256 initialMinimal,
        uint256 initialUnit
    ) ERC2771Context(trustedForwarder) ERC20(name, symbol) Ownable(msg.sender) {
        _tokenStorageAddress = storageCrowdToken;
        _mint(address(this), initialSupply);
        _managerAddress = initialManager;
        _whiteListContract = whiteListAddress;
        _minimal = initialMinimal;
        _unit = initialUnit;
    }

    function unit() public view returns (uint){
        return _unit;
    }

    function toRaise() public view returns (uint){
        return super.totalSupply() * _unit;
    }

    function raised() public view returns (uint){
        return _sold * _unit;
    }

    function viablePoint() public view returns (bool){
        return _viablePoint;
    }

    function minimal() public view returns (uint){
        return _minimal;
    }

    function canceledRaise() public view returns (bool){
        return _canceledRaise;
    }

    function managerAddress() public view returns (address){
        return _managerAddress;
    }

    function whiteListContract() public view returns (address){
        return _whiteListContract;
    }

    function sold() public view returns (uint){
        return _sold;
    }

    function tokenStorage() public view returns (address){
        return _tokenStorageAddress;
    }

    function addForPayment(
        Permission calldata permission,
        address beneficiary
    ) external onlyWhiteListed(beneficiary) {
        require(!_canceledRaise, "The raise was canceled. No more payments allowed");
        require(permission.value > 0, "Value should be greater than 0");
        require(
            permission.value <= ERC20(_tokenStorageAddress).balanceOf(permission.from),
            "Insufficient balance for transfer"
        );
        if (permission.to != address(this))
            revert InvalidTransferDestination();
        
        if (block.timestamp < permission.validAfter) 
            revert TransferAuthorizationNotYetValid();
        if (block.timestamp > permission.validBefore) 
            revert TransferAuthorizationExpired();

        if (
            permission.value %
            (10 ** ERC20(_tokenStorageAddress).decimals()) !=
            0
        ) revert InvalidUnitAmount();

        uint unitTransfer = permission.value / (10 ** ERC20(_tokenStorageAddress).decimals());
        if (unitTransfer % _unit != 0) revert InvalidUnitAmount();
        
        uint transferAmount = unitTransfer / _unit;
        if (_sold + transferAmount > super.totalSupply())
            revert ExceedsAvailableSupply();

        _sold = _sold + transferAmount;

        try IERC3009Partial(_tokenStorageAddress).transferWithAuthorization(
            permission.from,
            permission.to,
            permission.value,
            permission.validAfter,
            permission.validBefore,
            permission.nonce,
            permission.v,
            permission.r,
            permission.s
        ) {
            _transfer(address(this), beneficiary, transferAmount);

            if (_sold >= ((super.totalSupply() * _minimal) / 100)) {
                _viablePoint = true;
            }

            emit PaymentReceived(beneficiary, permission.value, transferAmount);
        } catch Error(string memory reason) {
            revert(reason);
        } catch {
            revert InvalidSignature();
        }
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function cancelRaise() external onlyOwner {
        _canceledRaise = true;
        _viablePoint = false;
        emit RaiseEnded(true);
    }

    function withdrawForDuty() external onlyOwner {
        if (_canceledRaise) revert RaiseCanceled();
        if (!_viablePoint) revert ViablePointNotReached();
        
        uint wholeAmount = ERC20(_tokenStorageAddress).balanceOf(address(this));
        ERC20(_tokenStorageAddress).transfer(_managerAddress, wholeAmount);
        emit DutyWithdrawn(_managerAddress, wholeAmount);
    }

    function withdrawPayment() external onlyWhiteListed(_msgSender()) {
        if (!_canceledRaise && _viablePoint) revert ViablePointAlreadyReached();
        
        uint refund = balanceOf(_msgSender());
        if (refund == 0) revert NoRefundAvailable();
        
        _sold = _sold - refund;
        _burn(_msgSender(), refund);
        _mint(address(this), refund);
        uint256 refundAmount = refund * _unit * 10 ** ERC20(_tokenStorageAddress).decimals();
        ERC20(_tokenStorageAddress).transfer(_msgSender(), refundAmount);
        emit PaymentReturned(_msgSender(), refundAmount);
    }

    function _msgSender() internal view virtual override(Context, ERC2771Context)
        returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view virtual override(Context, ERC2771Context)
        returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view virtual override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
```

## Contract: IERC3009Partial.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IERC3009Partial is IERC20Metadata {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
```

## Contract: IWhiteList.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IWhiteList {
    function addAddress(address whiteListAddress) external returns (bool);

    function deleteAddress(address addressToDelete) external returns (bool);

    function getAddressesInWhiteList() external view returns (address[] memory);

    function getAddressesInWhiteListPaginated(
        uint256 offset,
        uint256 itemsAmount
    ) external view returns (address[] memory);

    function isAddressWhiteListed(address addressToFind)
        external
        view
        returns (bool);

    function getWhiteListSize() external view returns (uint256);
}
```

## Contract: MockERC3009.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./IERC3009Partial.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MockERC3009 is ERC20, IERC3009Partial, EIP712 {
    using ECDSA for bytes32;
    
    uint8 private _decimalsValue;
    mapping(bytes32 => bool) public usedNonces;

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimalsValue_
    ) ERC20(name, symbol) EIP712(name, "1") {
        _decimalsValue = decimalsValue_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public view override(ERC20, IERC20Metadata) returns (uint8) {
        return _decimalsValue;
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        require(block.timestamp > validAfter, "Not yet valid");
        require(block.timestamp < validBefore, "Expired");
        require(!usedNonces[nonce], "Nonce already used");

        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        
        // Verify signature using ECDSA
        address recoveredAddress = ECDSA.recover(digest, v, r, s);
        require(recoveredAddress != address(0), "Invalid signature format");
        require(recoveredAddress == from, "Invalid signature");

        usedNonces[nonce] = true;
        _transfer(from, to, value);
    }

    // Helper function for tests to get the digest that needs to be signed
    function getDigestToSign(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        return _hashTypedDataV4(structHash);
    }
}
```

## Contract: MockForwarder.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockForwarder {
    function isTrustedForwarder(address) external pure returns (bool) {
        return true;
    }
}
```

## Contract: WhiteList.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IWhiteList.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract WhiteList is AccessControl, IWhiteList {
    bytes32 public constant MASTER_ROLE = keccak256("MASTER_ROLE");
    bytes32 public constant READER_ROLE = keccak256("READER_ROLE");
    bytes32 public constant WRITER_ROLE = keccak256("WRITER_ROLE");

    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private mySet;

    event AddressAdded(address indexed whiteListAddress);
    event AddressDeleted(address indexed addressDeleted);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(READER_ROLE, _msgSender());
        _grantRole(WRITER_ROLE, _msgSender());
        _grantRole(MASTER_ROLE, _msgSender());
    }

    function addAddress(address whiteListAddress)
        public
        override
        onlyRole(WRITER_ROLE)
        returns (bool)
    {
        bool added = mySet.add(whiteListAddress);
        if (added) {
            emit AddressAdded(whiteListAddress);
        }
        return added;
    }

    function deleteAddress(address addressToDelete)
        public
        override
        onlyRole(WRITER_ROLE)
        returns (bool)
    {
        bool removed = mySet.remove(addressToDelete);
        if (removed) {
            emit AddressDeleted(addressToDelete);
        }
        return removed;
    }

    function isAddressWhiteListed(address addressToFind)
        public
        view
        override
        onlyRole(READER_ROLE)
        returns (bool)
    {
        return mySet.contains(addressToFind);
    }

    function getAddressesInWhiteList()
        public
        view
        override
        onlyRole(READER_ROLE)
        returns (address[] memory)
    {
        return mySet.values();
    }

    function getAddressesInWhiteListPaginated(
        uint256 offset,
        uint256 itemsAmount
    ) public view override onlyRole(READER_ROLE) returns (address[] memory) {
        uint256 lengthArray = mySet.length();
        require(
            (int256(lengthArray) - int256(offset + itemsAmount)) >= 0,
            "Offset + itemsAmount bigger than the array"
        );
        address[] memory result = new address[](itemsAmount);
        uint256 counter = 1;
        uint256 index = 0;
        for (uint256 x = offset; counter <= itemsAmount; x++) {
            result[index] = mySet.at(x);
            index++;
            counter++;
        }
        return result;
    }

    function getWhiteListSize()
        external
        view
        override
        onlyRole(READER_ROLE)
        returns (uint256)
    {
        return mySet.length();
    }
}
```

## Tests: FiduciaryDutyTest.js

```javascript
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

describe("FiduciaryDuty", () => {
    // Helper function to create authorization data
    const createAuthorization = async (
        from,
        to,
        value,
        validAfter,
        validBefore,
        nonceStr,
        signer,
        mockUSDC
    ) => {
        const nonce = ethers.id(nonceStr);

        // Create typed data for EIP-712 signing
        const domain = {
            name: "Mock USDC", // Must match the name in MockERC3009 constructor
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await mockUSDC.getAddress()
        };

        const types = {
            TransferWithAuthorization: [
                { name: "from", type: "address" },
                { name: "to", type: "address" },
                { name: "value", type: "uint256" },
                { name: "validAfter", type: "uint256" },
                { name: "validBefore", type: "uint256" },
                { name: "nonce", type: "bytes32" }
            ]
        };

        const value712 = {
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce
        };

        // Sign using EIP-712
        const signature = await signer.signTypedData(domain, types, value712);
        const { v, r, s } = ethers.Signature.from(signature);

        return {
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        };
    };

    const deployFixture = async () => {
        const [owner, user1, manager] = await ethers.getSigners();

        // Deploy WhiteList
        const WhiteList = await ethers.getContractFactory("WhiteList");
        const whitelist = await WhiteList.deploy();

        // Deploy Mock USDC with ERC3009 functionality
        const MockToken = await ethers.getContractFactory("MockERC3009");
        const mockUSDC = await MockToken.deploy("Mock USDC", "mUSDC", 6);

        // Deploy Mock Forwarder
        const MockForwarder = await ethers.getContractFactory("MockForwarder");
        const forwarder = await MockForwarder.deploy();

        // Deploy FiduciaryDuty
        const FiduciaryDuty = await ethers.getContractFactory("FiduciaryDuty");
        const fiduciaryDuty = await FiduciaryDuty.deploy(
            await mockUSDC.getAddress(),
            "Fiduciary Token",
            "FDT",
            1000n, // totalSupply
            manager.address,
            await whitelist.getAddress(),
            await forwarder.getAddress(),
            80n, // minimalPoint
            10n // unit price
        );

        // Setup whitelist
        await whitelist.addAddress(owner.address);
        await whitelist.grantRole(await whitelist.READER_ROLE(), await fiduciaryDuty.getAddress());

        return {
            fiduciaryDuty,
            whitelist,
            mockUSDC,
            forwarder,
            owner,
            user1,
            manager
        };
    };

    describe("Initialization", () => {
        it("Should initialize with correct values", async () => {
            const { fiduciaryDuty, mockUSDC, manager, whitelist, forwarder } = await loadFixture(deployFixture);

            expect(await fiduciaryDuty.tokenStorage()).to.equal(await mockUSDC.getAddress());
            expect(await fiduciaryDuty.managerAddress()).to.equal(manager.address);
            expect(await fiduciaryDuty.whiteListContract()).to.equal(await whitelist.getAddress());
            expect(await fiduciaryDuty.viablePoint()).to.equal(false);
            expect(await fiduciaryDuty.canceledRaise()).to.equal(false);
            expect(await fiduciaryDuty.sold()).to.equal(0n);
            expect(await fiduciaryDuty.decimals()).to.equal(0);
        });

        it("Should have correct initial token distribution", async () => {
            const { fiduciaryDuty } = await loadFixture(deployFixture);

            const totalSupply = await fiduciaryDuty.totalSupply();
            const contractBalance = await fiduciaryDuty.balanceOf(await fiduciaryDuty.getAddress());

            expect(totalSupply).to.equal(1000n);
            expect(contractBalance).to.equal(totalSupply);
        });
    });

    describe("Additional Initialization Tests", () => {
        it("Should initialize with correct raised amount", async () => {
            const { fiduciaryDuty } = await loadFixture(deployFixture);
            expect(await fiduciaryDuty.raised()).to.equal(0n);
        });

        it("Should initialize with correct decimal value", async () => {
            const { fiduciaryDuty } = await loadFixture(deployFixture);
            expect(await fiduciaryDuty.decimals()).to.equal(0n);
        });
    });

    describe("Payment Functions", () => {
        it("Should not allow payment without whitelist", async () => {
            const { fiduciaryDuty, user1, mockUSDC } = await loadFixture(deployFixture);

            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce1",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(auth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "SenderNotWhitelisted");
        });

        it("Should not allow payment with invalid timing", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);

            // Mint tokens to user1 first
            await mockUSDC.mint(user1.address, 1000000000n);

            // Test validAfter > current time
            const futureAuth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour in future
                BigInt(Math.floor(Date.now() / 1000) + 7200), // 2 hours in future
                "nonce1",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(futureAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "TransferAuthorizationNotYetValid");

            // Test validBefore < current time
            const pastAuth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                1n, // Past time
                "nonce2",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(pastAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "TransferAuthorizationExpired");
        });

        it("Should not allow payment with invalid unit amounts", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 1000000000n);

            // Test non-divisible by token decimals
            const invalidDecimalAuth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000123n, // Not divisible by 10^6 (USDC decimals)
                0n,
                2n ** 48n - 1n,
                "nonce3",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(invalidDecimalAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "InvalidUnitAmount");

            // Test non-divisible by unit price
            const invalidUnitAuth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                15000000n, // 15 USDC (not divisible by 10 USDC unit price)
                0n,
                2n ** 48n - 1n,
                "nonce4",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(invalidUnitAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "InvalidUnitAmount");
        });

        it("Should handle multiple payments correctly", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 1000000000n);

            // Make multiple valid payments
            for(let i = 0; i < 3; i++) {
                const auth = await createAuthorization(
                    user1.address,
                    await fiduciaryDuty.getAddress(),
                    10000000n,
                    0n,
                    2n ** 48n - 1n,
                    `nonce${i+5}`,
                    user1,
                    mockUSDC
                );

                await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

                expect(await fiduciaryDuty.balanceOf(user1.address)).to.equal(BigInt(i + 1));
                expect(await fiduciaryDuty.sold()).to.equal(BigInt(i + 1));
            }
        });

        it("Should reach viable point correctly", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 10000000000n);

            // Buy 79% of supply (below minimal point)
            const auth1 = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                7900000000n, // 790 tokens worth
                0n,
                2n ** 48n - 1n,
                "nonce_large1",
                user1,
                mockUSDC
            );

            await fiduciaryDuty.connect(user1).addForPayment(auth1, user1.address);
            expect(await fiduciaryDuty.viablePoint()).to.equal(false);

            // Buy 2% more to reach viable point
            const auth2 = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                200000000n, // 20 tokens worth
                0n,
                2n ** 48n - 1n,
                "nonce_large2",
                user1,
                mockUSDC
            );

            await fiduciaryDuty.connect(user1).addForPayment(auth2, user1.address);
            expect(await fiduciaryDuty.viablePoint()).to.equal(true);
        });

        it("Should emit PaymentReceived event on successful payment", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n);

            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n, // 1 token worth
                0n,
                2n ** 48n - 1n,
                "nonce_event_test",
                user1,
                mockUSDC
            );

            await expect(fiduciaryDuty.connect(user1).addForPayment(auth, user1.address))
                .to.emit(fiduciaryDuty, "PaymentReceived")
                .withArgs(user1.address, 10000000n, 1n);
        });

        it("Should emit PaymentReturned event on successful withdrawal", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n);

            // Make initial payment
            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_withdraw_event",
                user1,
                mockUSDC
            );

            await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

            await expect(fiduciaryDuty.connect(user1).withdrawPayment())
                .to.emit(fiduciaryDuty, "PaymentReturned")
                .withArgs(user1.address, 10000000n); // Amount in USDC units
        });

        // ... continue with more test cases
    });

    describe("Withdrawal Functions", () => {
        it("Should not allow withdrawal without balance", async () => {
            const { fiduciaryDuty, owner } = await loadFixture(deployFixture);

            await expect(
                fiduciaryDuty.connect(owner).withdrawPayment()
            ).to.be.revertedWithCustomError(fiduciaryDuty, "NoRefundAvailable");
        });

    });

    describe("Withdrawal Scenarios", () => {
        it("Should handle multiple withdrawals correctly", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 1000000000n);

            // Make payment
            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_withdraw",
                user1,
                mockUSDC
            );

            await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

            // Cancel raise
            await fiduciaryDuty.cancelRaise();

            // Withdraw
            await fiduciaryDuty.connect(user1).withdrawPayment();

            // Verify state after withdrawal
            expect(await fiduciaryDuty.balanceOf(user1.address)).to.equal(0n);
            expect(await fiduciaryDuty.sold()).to.equal(0n);
            expect(await mockUSDC.balanceOf(user1.address)).to.equal(1000000000n);
        });

        it("Should emit PaymentWithdrawn event on successful withdrawal", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n);

            // Make initial payment
            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_withdraw_event",
                user1,
                mockUSDC
            );

            await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

            await expect(fiduciaryDuty.connect(user1).withdrawPayment())
                .to.emit(fiduciaryDuty, "PaymentReturned")
                .withArgs(user1.address, 10000000n);
        });

        // ... continue with more withdrawal scenarios
    });

    describe("Complex Multi-User Scenarios", () => {
        it("Should handle multiple users buying and withdrawing simultaneously", async () => {
            const { fiduciaryDuty, whitelist, mockUSDC } = await loadFixture(deployFixture);
            const [_, user1, user2, user3, user4] = await ethers.getSigners();

            // Setup users
            for (const user of [user1, user2, user3, user4]) {
                await whitelist.addAddress(user.address);
                await mockUSDC.mint(user.address, 100000000n * 100n); // 100 units each
            }

            // Multiple users buy tokens
            const buyAmount = 10000000n; // 10 USDC
            for (const user of [user1, user2, user3]) {
                const auth = await createAuthorization(
                    user.address,
                    await fiduciaryDuty.getAddress(),
                    buyAmount,
                    0n,
                    2n ** 48n - 1n,
                    `nonce_${user.address}`,
                    user,
                    mockUSDC
                );
                await fiduciaryDuty.connect(user).addForPayment(auth, user.address);
            }

            // Verify individual balances
            for (const user of [user1, user2, user3]) {
                expect(await fiduciaryDuty.balanceOf(user.address)).to.equal(1n);
            }
            expect(await fiduciaryDuty.sold()).to.equal(3n);

            // Cancel raise and test multiple withdrawals
            await fiduciaryDuty.cancelRaise();

            // All users try to withdraw simultaneously
            await Promise.all([user1, user2, user3].map(user =>
                fiduciaryDuty.connect(user).withdrawPayment()
            ));

            // Verify all balances are 0 and tokens returned
            for (const user of [user1, user2, user3]) {
                expect(await fiduciaryDuty.balanceOf(user.address)).to.equal(0n);
                expect(await mockUSDC.balanceOf(user.address)).to.equal(100000000n * 100n);
            }
            expect(await fiduciaryDuty.sold()).to.equal(0n);
        });

        it("Should handle race to viable point correctly", async () => {
            const { fiduciaryDuty, whitelist, mockUSDC } = await loadFixture(deployFixture);
            const [_, user1, user2] = await ethers.getSigners();

            // Setup users
            for (const user of [user1, user2]) {
                await whitelist.addAddress(user.address);
                await mockUSDC.mint(user.address, 1000000000n * 1000n);
            }

            // User1 buys 79% of supply
            const auth1 = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                7900000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_large_user1",
                user1,
                mockUSDC
            );
            await fiduciaryDuty.connect(user1).addForPayment(auth1, user1.address);
            expect(await fiduciaryDuty.viablePoint()).to.equal(false);

            // User2 tries to buy remaining supply
            const auth2 = await createAuthorization(
                user2.address,
                await fiduciaryDuty.getAddress(),
                2100000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_large_user2",
                user2,
                mockUSDC
            );
            await fiduciaryDuty.connect(user2).addForPayment(auth2, user2.address);

            expect(await fiduciaryDuty.viablePoint()).to.equal(true);
            expect(await fiduciaryDuty.sold()).to.equal(1000n);
        });

        it("Should handle edge cases with multiple users", async () => {
            const { fiduciaryDuty, whitelist, mockUSDC } = await loadFixture(deployFixture);
            const [_, user1, user2, user3] = await ethers.getSigners();

            // Setup users with enough tokens
            for (const user of [user1, user2, user3]) {
                await whitelist.addAddress(user.address);
                await mockUSDC.mint(user.address, 10000000000n); // 1000 USDC each
            }

            // Test case 1: Multiple users try to buy more than available
            // First user buys 500 tokens
            const auth1 = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                5000000000n, // 500 tokens
                0n,
                2n ** 48n - 1n,
                `nonce_large_${user1.address}`,
                user1,
                mockUSDC
            );
            await fiduciaryDuty.connect(user1).addForPayment(auth1, user1.address);

            // Second user buys 400 tokens
            const auth2 = await createAuthorization(
                user2.address,
                await fiduciaryDuty.getAddress(),
                4000000000n, // 400 tokens
                0n,
                2n ** 48n - 1n,
                `nonce_large_${user2.address}`,
                user2,
                mockUSDC
            );
            await fiduciaryDuty.connect(user2).addForPayment(auth2, user2.address);

            // Third user tries to buy 200 tokens when only 100 are left
            const auth3 = await createAuthorization(
                user3.address,
                await fiduciaryDuty.getAddress(),
                2000000000n, // Try to buy 200 tokens when only 100 left
                0n,
                2n ** 48n - 1n,
                "nonce_large_user3",
                user3,
                mockUSDC
            );

            // This should fail as there are not enough tokens left
            await expect(
                fiduciaryDuty.connect(user3).addForPayment(auth3, user3.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "ExceedsAvailableSupply");
        });

        it("Should handle whitelist revocation during active raise", async () => {
            const { fiduciaryDuty, whitelist, mockUSDC } = await loadFixture(deployFixture);
            const [_, user1] = await ethers.getSigners();

            // Setup initial state
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n);

            // First payment succeeds
            const auth1 = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_first",
                user1,
                mockUSDC
            );
            await fiduciaryDuty.connect(user1).addForPayment(auth1, user1.address);

            // Remove from whitelist using the correct method name
            await whitelist.deleteAddress(user1.address);

            // Second payment should fail
            const auth2 = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_second",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(auth2, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "SenderNotWhitelisted");
        });

        it("Should handle multiple users with different payment sizes", async () => {
            const { fiduciaryDuty, whitelist, mockUSDC } = await loadFixture(deployFixture);
            const [_, user1, user2, user3] = await ethers.getSigners();

            // Setup users with different amounts
            const userAmounts = [
                { user: user1, amount: 100000000n }, // 100 USDC
                { user: user2, amount: 200000000n }, // 200 USDC
                { user: user3, amount: 300000000n } // 300 USDC
            ];

            for (const { user, amount } of userAmounts) {
                await whitelist.addAddress(user.address);
                await mockUSDC.mint(user.address, amount);

                const auth = await createAuthorization(
                    user.address,
                    await fiduciaryDuty.getAddress(),
                    amount,
                    0n,
                    2n ** 48n - 1n,
                    `nonce_${user.address}`,
                    user,
                    mockUSDC
                );
                await fiduciaryDuty.connect(user).addForPayment(auth, user.address);
            }

            // Verify proportional token distribution
            expect(await fiduciaryDuty.balanceOf(user1.address)).to.equal(10n);
            expect(await fiduciaryDuty.balanceOf(user2.address)).to.equal(20n);
            expect(await fiduciaryDuty.balanceOf(user3.address)).to.equal(30n);
        });
    });

    describe("Withdrawal before viable point", () => {
        it("Should allow withdrawal before viable point is reached", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);

            // Setup user
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n); // 10 USDC

            // Make initial payment
            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n, // 1 token worth
                0n,
                2n ** 48n - 1n,
                "nonce_withdraw_test",
                user1,
                mockUSDC
            );

            // Add payment
            await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

            // Verify initial state
            expect(await fiduciaryDuty.balanceOf(user1.address)).to.equal(1n);
            expect(await fiduciaryDuty.sold()).to.equal(1n);
            expect(await fiduciaryDuty.viablePoint()).to.equal(false);

            // Get initial USDC balance
            const initialUSDCBalance = await mockUSDC.balanceOf(user1.address);

            // Withdraw before viable point
            await fiduciaryDuty.connect(user1).withdrawPayment();

            // Verify final state
            expect(await fiduciaryDuty.balanceOf(user1.address)).to.equal(0n);
            expect(await fiduciaryDuty.sold()).to.equal(0n);
            expect(await mockUSDC.balanceOf(user1.address)).to.equal(initialUSDCBalance + 10000000n);
            expect(await fiduciaryDuty.balanceOf(await fiduciaryDuty.getAddress())).to.equal(1000n);
        });

        it("Should handle multiple users withdrawing before viable point", async () => {
            const { fiduciaryDuty, whitelist, mockUSDC } = await loadFixture(deployFixture);
            const [_, user1, user2, user3] = await ethers.getSigners();

            // Setup users
            for (const user of [user1, user2, user3]) {
                await whitelist.addAddress(user.address);
                await mockUSDC.mint(user.address, 100000000n); // 10 USDC each
            }

            // All users make payments
            for (let i = 0; i < 3; i++) {
                const user = [user1, user2, user3][i];
                const auth = await createAuthorization(
                    user.address,
                    await fiduciaryDuty.getAddress(),
                    10000000n, // 1 token worth
                    0n,
                    2n ** 48n - 1n,
                    `nonce_multi_${i}`,
                    user,
                    mockUSDC
                );
                await fiduciaryDuty.connect(user).addForPayment(auth, user.address);
            }

            // Verify state after payments
            expect(await fiduciaryDuty.sold()).to.equal(3n);
            expect(await fiduciaryDuty.viablePoint()).to.equal(false);

            // Store initial USDC balances
            const initialBalances = await Promise.all(
                [user1, user2, user3].map(user => mockUSDC.balanceOf(user.address))
            );

            // All users withdraw
            for (const user of [user1, user2, user3]) {
                await fiduciaryDuty.connect(user).withdrawPayment();
            }

            // Verify final state
            expect(await fiduciaryDuty.sold()).to.equal(0n);

            // Verify each user got their USDC back
            for (let i = 0; i < 3; i++) {
                const user = [user1, user2, user3][i];
                expect(await fiduciaryDuty.balanceOf(user.address)).to.equal(0n);
                expect(await mockUSDC.balanceOf(user.address)).to.equal(initialBalances[i] + 10000000n);
            }

            // Verify contract balance is back to initial supply
            expect(await fiduciaryDuty.balanceOf(await fiduciaryDuty.getAddress())).to.equal(1000n);
        });

        it("Should not allow withdrawal after viable point unless canceled", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);

            // Setup user
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 10000000000n); // 1000 USDC

            // Buy enough tokens to reach viable point (80%)
            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                8000000000n, // 800 tokens worth
                0n,
                2n ** 48n - 1n,
                "nonce_viable_point",
                user1,
                mockUSDC
            );

            await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

            // Verify viable point is reached
            expect(await fiduciaryDuty.viablePoint()).to.equal(true);

            // Try to withdraw - should fail
            await expect(
                fiduciaryDuty.connect(user1).withdrawPayment()
            ).to.be.revertedWithCustomError(fiduciaryDuty, "ViablePointAlreadyReached");

            // Cancel raise
            await fiduciaryDuty.cancelRaise();

            // Now withdrawal should succeed
            await fiduciaryDuty.connect(user1).withdrawPayment();

            // Verify final state
            expect(await fiduciaryDuty.balanceOf(user1.address)).to.equal(0n);
            expect(await fiduciaryDuty.sold()).to.equal(0n);
        });
    });

    describe("Additional Test Scenarios", () => {
        it("should test payment with invalid signature", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n);

            const auth = {
                from: user1.address,
                to: user1.address, // Invalid destination - should be fiduciaryDuty address
                value: 10000000n,
                validAfter: 0n,
                validBefore: 2n ** 48n - 1n,
                nonce: ethers.id("invalid_sig"),
                v: 27,
                r: ethers.ZeroHash,
                s: ethers.ZeroHash
            };

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(auth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "InvalidTransferDestination");
        });

        it("should test authorization validation", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 200000000n);

            // Test with invalid destination
            const invalidDestAuth = await createAuthorization(
                user1.address,
                user1.address, // Invalid destination (should be fiduciaryDuty address)
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_invalid_dest",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(invalidDestAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "InvalidTransferDestination");

            // Test with expired authorization
            const expiredAuth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                1n, // Set to past timestamp
                "nonce_expired",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(expiredAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "TransferAuthorizationExpired");

            // Test with future authorization
            const futureAuth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour in future
                BigInt(Math.floor(Date.now() / 1000) + 7200), // 2 hours in future
                "nonce_future",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(futureAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "TransferAuthorizationNotYetValid");
        });

        describe("Manager withdrawal scenarios", () => {
            it("should allow manager to withdraw only after viable point", async () => {
                const { fiduciaryDuty, user1, whitelist, mockUSDC, manager } = await loadFixture(deployFixture);
                await whitelist.addAddress(user1.address);
                await mockUSDC.mint(user1.address, 10000000000n);

                // Buy 79% of supply (below viable point)
                const auth = await createAuthorization(
                    user1.address,
                    await fiduciaryDuty.getAddress(),
                    7900000000n,
                    0n,
                    2n ** 48n - 1n,
                    "nonce_manager_test",
                    user1,
                    mockUSDC
                );

                await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

                // Try to withdraw before viable point
                await expect(
                    fiduciaryDuty.withdrawForDuty()
                ).to.be.revertedWithCustomError(fiduciaryDuty, "ViablePointNotReached");

                // Buy remaining to reach viable point
                const auth2 = await createAuthorization(
                    user1.address,
                    await fiduciaryDuty.getAddress(),
                    100000000n,
                    0n,
                    2n ** 48n - 1n,
                    "nonce_manager_test2",
                    user1,
                    mockUSDC
                );

                await fiduciaryDuty.connect(user1).addForPayment(auth2, user1.address);

                // Now withdrawal should succeed
                await fiduciaryDuty.withdrawForDuty();

                // Verify USDC was transferred to manager
                expect(await mockUSDC.balanceOf(manager.address)).to.equal(8000000000n);
            });

            it("should not allow manager withdrawal after raise is canceled", async () => {
                const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
                await whitelist.addAddress(user1.address);
                await mockUSDC.mint(user1.address, 10000000000n);

                // Buy enough to reach viable point
                const auth = await createAuthorization(
                    user1.address,
                    await fiduciaryDuty.getAddress(),
                    8000000000n,
                    0n,
                    2n ** 48n - 1n,
                    "nonce_cancel_test",
                    user1,
                    mockUSDC
                );

                await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

                // Cancel the raise
                await fiduciaryDuty.cancelRaise();

                // Try to withdraw after cancellation
                await expect(
                    fiduciaryDuty.withdrawForDuty()
                ).to.be.revertedWithCustomError(fiduciaryDuty, "RaiseCanceled");
            });
        });

        describe("Edge cases for payment validation", () => {
            it("should validate payment amount matches token decimals", async () => {
                const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
                await whitelist.addAddress(user1.address);
                await mockUSDC.mint(user1.address, 10000000000n);

                // Create authorization with invalid decimal amount
                const auth = await createAuthorization(
                    user1.address,
                    await fiduciaryDuty.getAddress(),
                    10000123n, // Not divisible by 10^6 (USDC decimals)
                    0n,
                    2n ** 48n - 1n,
                    "nonce_decimal_test",
                    user1,
                    mockUSDC
                );

                await expect(
                    fiduciaryDuty.connect(user1).addForPayment(auth, user1.address)
                ).to.be.revertedWithCustomError(fiduciaryDuty, "InvalidUnitAmount");
            });
        });

        it("Should emit RaiseEnded event when raise is canceled", async () => {
            const { fiduciaryDuty } = await loadFixture(deployFixture);

            await expect(fiduciaryDuty.cancelRaise())
                .to.emit(fiduciaryDuty, "RaiseEnded")
                .withArgs(true);
        });
    });

    describe("Forwarder Tests", () => {
        it("Should initialize with correct forwarder", async () => {
            const { fiduciaryDuty, forwarder } = await loadFixture(deployFixture);
            expect(await fiduciaryDuty.trustedForwarder()).to.equal(await forwarder.getAddress());
        });

        it("Should correctly identify trusted forwarder", async () => {
            const { fiduciaryDuty, forwarder } = await loadFixture(deployFixture);
            expect(await fiduciaryDuty.isTrustedForwarder(await forwarder.getAddress())).to.be.true;
        });
    });

    describe("Event Tests", () => {
        it("Should emit PaymentAdded event", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n);

            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_event",
                user1,
                mockUSDC
            );

            await expect(fiduciaryDuty.connect(user1).addForPayment(auth, user1.address))
                .to.emit(fiduciaryDuty, "PaymentReceived")
                .withArgs(user1.address, 10000000n, 1n);
        });
    });
});
```
