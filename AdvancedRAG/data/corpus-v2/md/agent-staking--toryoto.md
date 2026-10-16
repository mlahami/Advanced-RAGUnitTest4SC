# agent-staking--toryoto

- domain: staking-yield (staking)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/toryoto/UniAgent @ d3d71c63e055ebdb4b33357ef450432f5055ddf5
- license: MIT
- targets: AgentStaking.sol, AgentIdentityRegistry.sol, StableCoin.sol
- validation: 37 passing tests, 0 failing; statement coverage AgentStaking.sol 100.0 %, AgentIdentityRegistry.sol 10.53 %, StableCoin.sol 4.17 %

## Contract: AgentIdentityRegistry.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/**
 * @title AgentIdentityRegistry
 * @notice ERC-8004 compliant Identity Registry for AI Agents
 * @dev ERC-721 based agent identity with IPFS metadata (ERC-8004 registration file)
 */
contract AgentIdentityRegistry is ERC721URIStorage {
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    uint256 private _nextTokenId;

    // agentId => metadataKey => metadataValue
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    // agentId => agentWallet (x402 payment receiver)
    mapping(uint256 => address) private _agentWallets;

    // Track all minted token IDs for enumeration
    uint256[] private _allTokenIds;

    // ============================================================================
    // Events (ERC-8004)
    // ============================================================================

    event Registered(
        uint256 indexed agentId,
        string agentURI,
        address indexed owner
    );

    event URIUpdated(
        uint256 indexed agentId,
        string newURI,
        address indexed updatedBy
    );

    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );

    event AgentWalletSet(
        uint256 indexed agentId,
        address wallet
    );

    event AgentWalletUnset(
        uint256 indexed agentId
    );

    event Burned(
        uint256 indexed agentId,
        address indexed owner
    );

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor() ERC721("UniAgent Registry", "UNIAGENT") {
        _nextTokenId = 1;
    }

    // ============================================================================
    // Registration (ERC-8004)
    // ============================================================================

    /**
     * @notice Register a new agent with URI and metadata
     * @param agentURI IPFS URI pointing to ERC-8004 registration file
     * @param metadata Array of key-value metadata entries
     * @return agentId The token ID assigned to the agent
     */
    function register(
        string calldata agentURI,
        MetadataEntry[] calldata metadata
    ) external returns (uint256 agentId) {
        agentId = _nextTokenId++;
        _safeMint(msg.sender, agentId);
        _setTokenURI(agentId, agentURI);

        for (uint256 i = 0; i < metadata.length; i++) {
            require(
                keccak256(bytes(metadata[i].metadataKey)) != keccak256(bytes("agentWallet")),
                "AgentIdentityRegistry: use setAgentWallet"
            );
            _metadata[agentId][metadata[i].metadataKey] = metadata[i].metadataValue;
            emit MetadataSet(agentId, metadata[i].metadataKey, metadata[i].metadataKey, metadata[i].metadataValue);
        }

        _allTokenIds.push(agentId);

        emit Registered(agentId, agentURI, msg.sender);
    }

    /**
     * @notice Register a new agent with URI only (no metadata)
     * @param agentURI IPFS URI pointing to ERC-8004 registration file
     * @return agentId The token ID assigned to the agent
     */
    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = _nextTokenId++;
        _safeMint(msg.sender, agentId);
        _setTokenURI(agentId, agentURI);

        _allTokenIds.push(agentId);

        emit Registered(agentId, agentURI, msg.sender);
    }

    // ============================================================================
    // URI Management (ERC-8004)
    // ============================================================================

    /**
     * @notice Update the agent's metadata URI (owner only)
     * @param agentId The agent token ID
     * @param newURI New IPFS URI
     */
    function setAgentURI(uint256 agentId, string calldata newURI) external {
        require(ownerOf(agentId) == msg.sender, "AgentIdentityRegistry: not owner");
        _setTokenURI(agentId, newURI);
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    // ============================================================================
    // Metadata Management (ERC-8004)
    // ============================================================================

    /**
     * @notice Get on-chain metadata for an agent
     * @param agentId The agent token ID
     * @param metadataKey The metadata key
     * @return The metadata value as bytes
     */
    function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory) {
        require(_ownerOf(agentId) != address(0), "AgentIdentityRegistry: agent does not exist");
        return _metadata[agentId][metadataKey];
    }

    /**
     * @notice Set on-chain metadata for an agent (owner only)
     * @param agentId The agent token ID
     * @param metadataKey The metadata key
     * @param metadataValue The metadata value as bytes
     */
    function setMetadata(
        uint256 agentId,
        string memory metadataKey,
        bytes memory metadataValue
    ) external {
        require(ownerOf(agentId) == msg.sender, "AgentIdentityRegistry: not owner");
        require(
            keccak256(bytes(metadataKey)) != keccak256(bytes("agentWallet")),
            "AgentIdentityRegistry: use setAgentWallet"
        );
        _metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    // ============================================================================
    // Agent Wallet (ERC-8004)
    // ============================================================================

    /**
     * @notice Set the agent's wallet address (owner only, simplified without EIP-712)
     * @param agentId The agent token ID
     * @param newWallet The wallet address to set
     */
    function setAgentWallet(uint256 agentId, address newWallet) external {
        require(ownerOf(agentId) == msg.sender, "AgentIdentityRegistry: not owner");
        require(newWallet != address(0), "AgentIdentityRegistry: invalid wallet");
        _agentWallets[agentId] = newWallet;
        emit AgentWalletSet(agentId, newWallet);
    }

    /**
     * @notice Get the agent's wallet address
     * @param agentId The agent token ID
     * @return The agent's wallet address
     */
    function getAgentWallet(uint256 agentId) external view returns (address) {
        require(_ownerOf(agentId) != address(0), "AgentIdentityRegistry: agent does not exist");
        return _agentWallets[agentId];
    }

    /**
     * @notice Remove the agent's wallet address (owner only)
     * @param agentId The agent token ID
     */
    function unsetAgentWallet(uint256 agentId) external {
        require(ownerOf(agentId) == msg.sender, "AgentIdentityRegistry: not owner");
        delete _agentWallets[agentId];
        emit AgentWalletUnset(agentId);
    }

    /**
     * @notice Burn an agent token, removing it from the registry (owner only)
     * @param agentId The agent token ID to burn
     */
    function burn(uint256 agentId) external {
        require(ownerOf(agentId) == msg.sender, "AgentIdentityRegistry: not owner");

        // Remove from _allTokenIds via swap-and-pop (linear scan; acceptable for registry scale)
        uint256 len = _allTokenIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (_allTokenIds[i] == agentId) {
                _allTokenIds[i] = _allTokenIds[len - 1];
                _allTokenIds.pop();
                break;
            }
        }

        // Clean up auxiliary mappings
        delete _agentWallets[agentId];

        address burner = msg.sender;
        _burn(agentId); // ERC721URIStorage._burn also clears tokenURI
        emit Burned(agentId, burner);
    }

    // ============================================================================
    // Enumeration
    // ============================================================================

    /**
     * @notice Get the total number of registered agents
     * @return Total count of registered agents
     */
    function totalSupply() external view returns (uint256) {
        return _allTokenIds.length;
    }

    /**
     * @notice Get all registered agent IDs
     * @return Array of all agent token IDs
     */
    function getAllAgentIds() external view returns (uint256[] memory) {
        return _allTokenIds;
    }

    /**
     * @notice Get agent ID at a specific index
     * @param index The index in the token list
     * @return The agent token ID at the given index
     */
    function agentIdAtIndex(uint256 index) external view returns (uint256) {
        require(index < _allTokenIds.length, "AgentIdentityRegistry: index out of bounds");
        return _allTokenIds[index];
    }
}
```

## Contract: AgentStaking.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentStaking
 * @notice USDC staking for registered AI agents — provides skin-in-the-game
 *         signal consumed by the discovery ranking algorithm.
 * @dev Separated from AgentIdentityRegistry (ERC-8004) by design.
 *      Unstaking requires a 7-day cooldown to prevent stake-and-dump attacks.
 */
contract AgentStaking is Ownable {
    using SafeERC20 for IERC20;

    struct UnstakeRequest {
        uint256 amount;
        uint256 availableAt;
    }

    IERC20 public immutable usdc;
    IERC721 public immutable registry;

    address public treasury;
    uint256 public constant COOLDOWN = 7 days;

    mapping(uint256 => uint256) public stakes;
    mapping(uint256 => UnstakeRequest) public unstakeRequests;

    event Staked(uint256 indexed agentId, address indexed staker, uint256 amount, uint256 totalStake);
    event UnstakeRequested(uint256 indexed agentId, uint256 amount, uint256 availableAt);
    event UnstakeCancelled(uint256 indexed agentId);
    event Unstaked(uint256 indexed agentId, address indexed staker, uint256 amount, uint256 totalStake);
    event Slashed(uint256 indexed agentId, uint256 amount, string reason);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    constructor(address _usdc, address _registry, address _treasury) Ownable(msg.sender) {
        require(_usdc != address(0), "AgentStaking: zero usdc");
        require(_registry != address(0), "AgentStaking: zero registry");
        require(_treasury != address(0), "AgentStaking: zero treasury");

        usdc = IERC20(_usdc);
        registry = IERC721(_registry);
        treasury = _treasury;
    }

    modifier onlyAgentOwner(uint256 agentId) {
        require(registry.ownerOf(agentId) == msg.sender, "AgentStaking: not agent owner");
        _;
    }

    /**
     * @notice Deposit USDC as stake for an agent. Caller must have approved
     *         this contract to spend `amount` of USDC beforehand.
     */
    function stake(uint256 agentId, uint256 amount) external onlyAgentOwner(agentId) {
        require(amount > 0, "AgentStaking: zero amount");

        stakes[agentId] += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(agentId, msg.sender, amount, stakes[agentId]);
    }

    /**
     * @notice Begin the unstake process. The staked amount remains locked for
     *         COOLDOWN seconds. A new request overwrites any pending one.
     */
    function requestUnstake(uint256 agentId, uint256 amount) external onlyAgentOwner(agentId) {
        require(amount > 0, "AgentStaking: zero amount");
        require(amount <= stakes[agentId], "AgentStaking: exceeds stake");

        uint256 availableAt = block.timestamp + COOLDOWN;
        unstakeRequests[agentId] = UnstakeRequest(amount, availableAt);

        emit UnstakeRequested(agentId, amount, availableAt);
    }

    /**
     * @notice Finalize a matured unstake request, returning USDC to the agent owner.
     */
    function executeUnstake(uint256 agentId) external onlyAgentOwner(agentId) {
        UnstakeRequest memory req = unstakeRequests[agentId];
        require(req.amount > 0, "AgentStaking: no request");
        require(block.timestamp >= req.availableAt, "AgentStaking: cooldown active");

        uint256 withdrawable = _min(req.amount, stakes[agentId]);
        delete unstakeRequests[agentId];

        if (withdrawable > 0) {
            stakes[agentId] -= withdrawable;
            usdc.safeTransfer(msg.sender, withdrawable);
        }

        emit Unstaked(agentId, msg.sender, withdrawable, stakes[agentId]);
    }

    /**
     * @notice Cancel a pending unstake request.
     */
    function cancelUnstake(uint256 agentId) external onlyAgentOwner(agentId) {
        require(unstakeRequests[agentId].amount > 0, "AgentStaking: no request");
        delete unstakeRequests[agentId];

        emit UnstakeCancelled(agentId);
    }

    /**
     * @notice Confiscate staked USDC from a malicious agent and send to treasury.
     *         Automatically shrinks any pending unstake request to prevent underflow.
     */
    function slash(uint256 agentId, uint256 amount, string calldata reason) external onlyOwner {
        require(amount > 0, "AgentStaking: zero amount");

        uint256 slashable = _min(amount, stakes[agentId]);
        require(slashable > 0, "AgentStaking: nothing to slash");

        stakes[agentId] -= slashable;

        UnstakeRequest storage req = unstakeRequests[agentId];
        if (req.amount > stakes[agentId]) {
            req.amount = stakes[agentId];
        }

        usdc.safeTransfer(treasury, slashable);

        emit Slashed(agentId, slashable, reason);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "AgentStaking: zero address");
        address old = treasury;
        treasury = newTreasury;

        emit TreasuryUpdated(old, newTreasury);
    }

    function getStake(uint256 agentId) external view returns (uint256) {
        return stakes[agentId];
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
```

## Contract: StableCoin.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT 
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract Stablecoin is ERC20, ERC20Burnable, Ownable, EIP712 {
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    bytes32 private constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    
    bytes32 private constant CANCEL_AUTHORIZATION_TYPEHASH = keccak256(
        "CancelAuthorization(address authorizer,bytes32 nonce)"
    );

    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;
    
    uint8 private _decimals;

    constructor(
        string memory name_, 
        string memory symbol_, 
        uint256 initialSupply,
        uint8 decimals_
    ) 
        ERC20(name_, symbol_)
        EIP712(name_, "2")
        Ownable(msg.sender)
    {
        _decimals = decimals_;
        _mint(msg.sender, initialSupply);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) public onlyOwner {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Amount must be positive");
        _mint(to, amount);
    }

    function authorizationState(address authorizer, bytes32 nonce) 
        external view returns (bool) 
    {
        return _authorizationStates[authorizer][nonce];
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
    ) external {
        require(block.timestamp > validAfter, "Authorization not yet valid");
        require(block.timestamp < validBefore, "Authorization expired");
        require(!_authorizationStates[from][nonce], "Authorization already used");

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
        
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == from, "Invalid signature");

        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        
        _transfer(from, to, value);
    }

    function cancelAuthorization(
        address authorizer,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(!_authorizationStates[authorizer][nonce], "Authorization already used");

        bytes32 structHash = keccak256(
            abi.encode(
                CANCEL_AUTHORIZATION_TYPEHASH,
                authorizer,
                nonce
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == authorizer, "Invalid signature");

        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
    
    function getTransferWithAuthorizationTypeHash() external pure returns (bytes32) {
        return TRANSFER_WITH_AUTHORIZATION_TYPEHASH;
    }
    
    function getCancelAuthorizationTypeHash() external pure returns (bytes32) {
        return CANCEL_AUTHORIZATION_TYPEHASH;
    }
}
```

## Tests: AgentStaking.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe('AgentStaking', function () {
  let staking;
  let registry;
  let usdc;

  let deployer;
  let agentOwner;
  let otherUser;
  let treasury;

  const COOLDOWN = 7 * 24 * 60 * 60; // 7 days in seconds
  const USDC_DECIMALS = 6;
  const toUSDC = (n) => ethers.parseUnits(n.toString(), USDC_DECIMALS);

  let agentId;

  beforeEach(async function () {
    [deployer, agentOwner, otherUser, treasury] = await ethers.getSigners();

    // Deploy USDC
    const USDCFactory = await ethers.getContractFactory('Stablecoin');
    usdc = await USDCFactory.deploy('USDC', 'USDC', toUSDC(1_000_000), USDC_DECIMALS);
    await usdc.waitForDeployment();

    // Distribute USDC to agentOwner
    await usdc.transfer(agentOwner.address, toUSDC(10_000));

    // Deploy AgentIdentityRegistry
    const RegistryFactory = await ethers.getContractFactory('AgentIdentityRegistry');
    registry = await RegistryFactory.deploy();
    await registry.waitForDeployment();

    // Register an agent (agentId = 1)
    await registry.connect(agentOwner)['register(string)']('ipfs://QmTest');
    agentId = 1;

    // Deploy AgentStaking
    const StakingFactory = await ethers.getContractFactory('AgentStaking');
    staking = await StakingFactory.deploy(
      await usdc.getAddress(),
      await registry.getAddress(),
      treasury.address
    );
    await staking.waitForDeployment();

    // Approve staking contract to spend agentOwner's USDC
    await usdc.connect(agentOwner).approve(await staking.getAddress(), ethers.MaxUint256);
  });

  // ============================================================================
  // Constructor
  // ============================================================================

  describe('Constructor', function () {
    it('should set immutables and treasury correctly', async function () {
      expect(await staking.usdc()).to.equal(await usdc.getAddress());
      expect(await staking.registry()).to.equal(await registry.getAddress());
      expect(await staking.treasury()).to.equal(treasury.address);
    });

    it('should reject zero addresses', async function () {
      const F = await ethers.getContractFactory('AgentStaking');
      await expect(
        F.deploy(ethers.ZeroAddress, await registry.getAddress(), treasury.address)
      ).to.be.revertedWith('AgentStaking: zero usdc');
      await expect(
        F.deploy(await usdc.getAddress(), ethers.ZeroAddress, treasury.address)
      ).to.be.revertedWith('AgentStaking: zero registry');
      await expect(
        F.deploy(await usdc.getAddress(), await registry.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith('AgentStaking: zero treasury');
    });
  });

  // ============================================================================
  // Stake
  // ============================================================================

  describe('Stake', function () {
    it('should stake USDC successfully', async function () {
      await expect(staking.connect(agentOwner).stake(agentId, toUSDC(100)))
        .to.emit(staking, 'Staked')
        .withArgs(agentId, agentOwner.address, toUSDC(100), toUSDC(100));

      expect(await staking.getStake(agentId)).to.equal(toUSDC(100));
    });

    it('should accumulate multiple stakes', async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(50));
      await staking.connect(agentOwner).stake(agentId, toUSDC(75));

      expect(await staking.getStake(agentId)).to.equal(toUSDC(125));
    });

    it('should transfer USDC from staker to contract', async function () {
      const balanceBefore = await usdc.balanceOf(agentOwner.address);
      await staking.connect(agentOwner).stake(agentId, toUSDC(100));
      const balanceAfter = await usdc.balanceOf(agentOwner.address);

      expect(balanceBefore - balanceAfter).to.equal(toUSDC(100));
      expect(await usdc.balanceOf(await staking.getAddress())).to.equal(toUSDC(100));
    });

    it('should revert for non-owner of agent NFT', async function () {
      await expect(
        staking.connect(otherUser).stake(agentId, toUSDC(100))
      ).to.be.revertedWith('AgentStaking: not agent owner');
    });

    it('should revert for zero amount', async function () {
      await expect(
        staking.connect(agentOwner).stake(agentId, 0)
      ).to.be.revertedWith('AgentStaking: zero amount');
    });

    it('should revert if USDC not approved', async function () {
      await usdc.connect(agentOwner).approve(await staking.getAddress(), 0);
      await expect(
        staking.connect(agentOwner).stake(agentId, toUSDC(100))
      ).to.be.reverted;
    });
  });

  // ============================================================================
  // Request Unstake
  // ============================================================================

  describe('Request Unstake', function () {
    beforeEach(async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(500));
    });

    it('should create an unstake request', async function () {
      const tx = await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(200));
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt .blockNumber);
      const expectedAvailable = block .timestamp + COOLDOWN;

      await expect(tx)
        .to.emit(staking, 'UnstakeRequested')
        .withArgs(agentId, toUSDC(200), expectedAvailable);

      const req = await staking.unstakeRequests(agentId);
      expect(req.amount).to.equal(toUSDC(200));
      expect(req.availableAt).to.equal(expectedAvailable);
    });

    it('should not reduce stakes on request', async function () {
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(200));
      expect(await staking.getStake(agentId)).to.equal(toUSDC(500));
    });

    it('should overwrite existing request', async function () {
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(100));
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(300));

      const req = await staking.unstakeRequests(agentId);
      expect(req.amount).to.equal(toUSDC(300));
    });

    it('should revert if amount exceeds stake', async function () {
      await expect(
        staking.connect(agentOwner).requestUnstake(agentId, toUSDC(501))
      ).to.be.revertedWith('AgentStaking: exceeds stake');
    });

    it('should revert for zero amount', async function () {
      await expect(
        staking.connect(agentOwner).requestUnstake(agentId, 0)
      ).to.be.revertedWith('AgentStaking: zero amount');
    });

    it('should revert for non-owner', async function () {
      await expect(
        staking.connect(otherUser).requestUnstake(agentId, toUSDC(100))
      ).to.be.revertedWith('AgentStaking: not agent owner');
    });
  });

  // ============================================================================
  // Execute Unstake
  // ============================================================================

  describe('Execute Unstake', function () {
    beforeEach(async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(500));
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(200));
    });

    it('should execute after cooldown', async function () {
      await time.increase(COOLDOWN);

      await expect(staking.connect(agentOwner).executeUnstake(agentId))
        .to.emit(staking, 'Unstaked')
        .withArgs(agentId, agentOwner.address, toUSDC(200), toUSDC(300));

      expect(await staking.getStake(agentId)).to.equal(toUSDC(300));

      const req = await staking.unstakeRequests(agentId);
      expect(req.amount).to.equal(0);
    });

    it('should return USDC to agent owner', async function () {
      await time.increase(COOLDOWN);

      const balanceBefore = await usdc.balanceOf(agentOwner.address);
      await staking.connect(agentOwner).executeUnstake(agentId);
      const balanceAfter = await usdc.balanceOf(agentOwner.address);

      expect(balanceAfter - balanceBefore).to.equal(toUSDC(200));
    });

    it('should revert before cooldown', async function () {
      await time.increase(COOLDOWN - 10);

      await expect(
        staking.connect(agentOwner).executeUnstake(agentId)
      ).to.be.revertedWith('AgentStaking: cooldown active');
    });

    it('should revert when no request exists', async function () {
      // Register a second agent, stake, but don't request unstake
      await registry.connect(agentOwner)['register(string)']('ipfs://QmTest2');
      await staking.connect(agentOwner).stake(2, toUSDC(100));

      await expect(
        staking.connect(agentOwner).executeUnstake(2)
      ).to.be.revertedWith('AgentStaking: no request');
    });

    it('should revert for non-owner', async function () {
      await time.increase(COOLDOWN);
      await expect(
        staking.connect(otherUser).executeUnstake(agentId)
      ).to.be.revertedWith('AgentStaking: not agent owner');
    });
  });

  // ============================================================================
  // Cancel Unstake
  // ============================================================================

  describe('Cancel Unstake', function () {
    beforeEach(async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(500));
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(200));
    });

    it('should cancel pending request', async function () {
      await expect(staking.connect(agentOwner).cancelUnstake(agentId))
        .to.emit(staking, 'UnstakeCancelled')
        .withArgs(agentId);

      const req = await staking.unstakeRequests(agentId);
      expect(req.amount).to.equal(0);
    });

    it('should keep stakes unchanged', async function () {
      await staking.connect(agentOwner).cancelUnstake(agentId);
      expect(await staking.getStake(agentId)).to.equal(toUSDC(500));
    });

    it('should revert when no request exists', async function () {
      await staking.connect(agentOwner).cancelUnstake(agentId);
      await expect(
        staking.connect(agentOwner).cancelUnstake(agentId)
      ).to.be.revertedWith('AgentStaking: no request');
    });

    it('should revert for non-owner', async function () {
      await expect(
        staking.connect(otherUser).cancelUnstake(agentId)
      ).to.be.revertedWith('AgentStaking: not agent owner');
    });
  });

  // ============================================================================
  // Slash
  // ============================================================================

  describe('Slash', function () {
    beforeEach(async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(500));
    });

    it('should slash and send USDC to treasury', async function () {
      await expect(staking.connect(deployer).slash(agentId, toUSDC(100), 'malicious'))
        .to.emit(staking, 'Slashed')
        .withArgs(agentId, toUSDC(100), 'malicious');

      expect(await staking.getStake(agentId)).to.equal(toUSDC(400));
      expect(await usdc.balanceOf(treasury.address)).to.equal(toUSDC(100));
    });

    it('should cap slash at available stake', async function () {
      await staking.connect(deployer).slash(agentId, toUSDC(9999), 'severe');

      expect(await staking.getStake(agentId)).to.equal(0);
      expect(await usdc.balanceOf(treasury.address)).to.equal(toUSDC(500));
    });

    it('should auto-shrink pending unstake request', async function () {
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(400));

      // Slash 200 → stakes goes from 500 to 300, pending 400 → 300
      await staking.connect(deployer).slash(agentId, toUSDC(200), 'partial');

      const req = await staking.unstakeRequests(agentId);
      expect(req.amount).to.equal(toUSDC(300));
      expect(await staking.getStake(agentId)).to.equal(toUSDC(300));
    });

    it('should zero out pending unstake on full slash', async function () {
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(400));

      await staking.connect(deployer).slash(agentId, toUSDC(500), 'full');

      const req = await staking.unstakeRequests(agentId);
      expect(req.amount).to.equal(0);
      expect(await staking.getStake(agentId)).to.equal(0);
    });

    it('should revert for non-owner (deployer)', async function () {
      await expect(
        staking.connect(agentOwner).slash(agentId, toUSDC(100), 'attempt')
      ).to.be.revertedWithCustomError(staking, 'OwnableUnauthorizedAccount');
    });

    it('should revert for zero amount', async function () {
      await expect(
        staking.connect(deployer).slash(agentId, 0, 'zero')
      ).to.be.revertedWith('AgentStaking: zero amount');
    });

    it('should revert when nothing to slash', async function () {
      await expect(
        staking.connect(deployer).slash(999, toUSDC(100), 'no stake')
      ).to.be.revertedWith('AgentStaking: nothing to slash');
    });
  });

  // ============================================================================
  // Slash + Execute Unstake Interaction
  // ============================================================================

  describe('Slash + Execute Unstake', function () {
    it('should allow partial withdrawal after slash', async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(100));
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(80));

      // Slash 50 → stakes = 50, pending 80 → 50
      await staking.connect(deployer).slash(agentId, toUSDC(50), 'partial');

      await time.increase(COOLDOWN);
      await staking.connect(agentOwner).executeUnstake(agentId);

      expect(await staking.getStake(agentId)).to.equal(0);
      expect(await usdc.balanceOf(treasury.address)).to.equal(toUSDC(50));
    });
  });

  // ============================================================================
  // Treasury
  // ============================================================================

  describe('Treasury', function () {
    it('should update treasury address', async function () {
      await expect(staking.connect(deployer).setTreasury(otherUser.address))
        .to.emit(staking, 'TreasuryUpdated')
        .withArgs(treasury.address, otherUser.address);

      expect(await staking.treasury()).to.equal(otherUser.address);
    });

    it('should reject zero address', async function () {
      await expect(
        staking.connect(deployer).setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith('AgentStaking: zero address');
    });

    it('should reject non-owner', async function () {
      await expect(
        staking.connect(otherUser).setTreasury(otherUser.address)
      ).to.be.revertedWithCustomError(staking, 'OwnableUnauthorizedAccount');
    });
  });

  // ============================================================================
  // View
  // ============================================================================

  describe('View', function () {
    it('should return 0 for unstaked agent', async function () {
      expect(await staking.getStake(999)).to.equal(0);
    });

    it('should reflect correct stake after operations', async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(200));
      expect(await staking.getStake(agentId)).to.equal(toUSDC(200));

      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(50));
      await time.increase(COOLDOWN);
      await staking.connect(agentOwner).executeUnstake(agentId);
      expect(await staking.getStake(agentId)).to.equal(toUSDC(150));

      await staking.connect(deployer).slash(agentId, toUSDC(30), 'test');
      expect(await staking.getStake(agentId)).to.equal(toUSDC(120));
    });
  });

  // ============================================================================
  // NFT Transfer Scenario
  // ============================================================================

  describe('NFT Transfer', function () {
    it('should let new NFT owner manage stakes after transfer', async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(100));

      // Transfer NFT to otherUser
      await registry.connect(agentOwner).transferFrom(agentOwner.address, otherUser.address, agentId);

      // Old owner can no longer unstake
      await expect(
        staking.connect(agentOwner).requestUnstake(agentId, toUSDC(50))
      ).to.be.revertedWith('AgentStaking: not agent owner');

      // New owner can
      await staking.connect(otherUser).requestUnstake(agentId, toUSDC(50));
      await time.increase(COOLDOWN);

      // USDC goes to new owner
      const balanceBefore = await usdc.balanceOf(otherUser.address);
      await staking.connect(otherUser).executeUnstake(agentId);
      const balanceAfter = await usdc.balanceOf(otherUser.address);

      expect(balanceAfter - balanceBefore).to.equal(toUSDC(50));
      expect(await staking.getStake(agentId)).to.equal(toUSDC(50));
    });
  });
});
```
