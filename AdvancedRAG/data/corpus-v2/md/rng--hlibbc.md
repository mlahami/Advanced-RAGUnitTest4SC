# rng--hlibbc

- domain: games-lotteries (commit-reveal)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/hlibbc/solidity-practice @ 9f6fa3709e9815f52e8dbd86b87fbe412836bcfa
- license: MIT
- targets: Rng.sol, Main.sol
- validation: 14 passing tests, 0 failing; statement coverage Rng.sol 100.0 %, Main.sol 100.0 %

## Contract: Main.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Main Controller Contract for Round Lifecycle
 * @notice This contract manages the lifecycle of a lottery or raffle round: 
 *     from start to end to settlement.
 * @dev It interacts with the Rng (Random Number Generator) contract via low-level ABI-encoded calls to:
 *     - Register a signed seed when starting a new round (commit)
 *     - Seal entropy at the end of the round (sealEntropy)
 *     - Verify the signed seed and finalize the random value (reveal)
 * @author hlibbc
 */

contract Main is Ownable {

    // ENUM 정의
    enum RoundStatus { 
        NotStarted, // 라운드 시작전
        Proceeding, // 진행중: startRound 에 의해 천이
        Drawing, // 개표중: endRound 에 의해 천이
        Claiming, // 당첨금수령중: settleRound 에 의해 천이
        Ended // 종료 
    }

    enum ContractTags {
        Rng, // Rng 컨트랙트
        TagMax
    }

    struct RoundManageInfo {
        RoundStatus status; // 라운드 상태
        uint64 endedAt; // 라운드 종료 시각 (endRound 호출시각)
        uint64 settledAt; // 라운드 정산 시각 (settleRound 호출시각)
        bytes32 winningHash; // 최종 랜덤값
    }

    mapping(uint256 => RoundManageInfo) public roundManageInfo; // 라운드별 정보관리 매핑변수

    address[] public managedContracts; // Inter-action 컨트랙트 리스트

    // 이벤트 정의
    event RoundStarted(uint256 indexed roundId);
    event RoundEnded(uint256 indexed roundId, address indexed msgSender);
    event RoundSettled(uint256 indexed roundId);

    /**
     * @notice constructor
     */
    constructor() Ownable(msg.sender) {}

    function setContracts(
        address[] memory _contractAddrs
    ) external onlyOwner {
        require(_contractAddrs.length == uint256(ContractTags.TagMax), "Incorrect Contract Nums");
        delete managedContracts;
        for(uint i = 0; i < uint256(ContractTags.TagMax); i++) {
            managedContracts.push(_contractAddrs[i]);
        }
    }

    /**
     * @notice Start a round
     * @dev onlyOwner
     * @param _roundId Round ID
     * @param _signature Data signature
     */
    function startRound(
        uint256 _roundId, 
        bytes calldata _signature
    ) external onlyOwner {
        RoundManageInfo storage info = roundManageInfo[_roundId];
        require(info.status == RoundStatus.NotStarted, "Round already started");

        // abi.encodeWithSelector 방식 호출
        (bool success, ) = managedContracts[uint8(ContractTags.Rng)].call(
            abi.encodeWithSelector(
                bytes4(keccak256("commit(uint256,bytes)")),
                _roundId,
                _signature
            )
        );
        require(success, "RNG: commit failed");

        info.status = RoundStatus.Proceeding;
        emit RoundStarted(_roundId);
    }

    /**
     * @notice End the round
     * @dev anyone can call
     * @param _roundId Round ID
     */
    function endRound(
        uint256 _roundId
    ) external {
        RoundManageInfo storage info = roundManageInfo[_roundId];
        require(info.status == RoundStatus.Proceeding, "Round not active");

        (bool success, ) = managedContracts[uint8(ContractTags.Rng)].call(
            abi.encodeWithSelector(
                bytes4(keccak256("sealEntropy(uint256,address)")),
                _roundId,
                msg.sender
            )
        );
        require(success, "RNG: sealEntropy failed");

        info.status = RoundStatus.Drawing;
        info.endedAt = uint64(block.timestamp);

        emit RoundEnded(_roundId, msg.sender);
    }

    /**
     * @notice Settle the round
     * @dev onlyOwner
     * @param _roundId Round ID
     * @param _randSeed seed value (Initially generated)
     */
    function settleRound(
        uint256 _roundId, 
        uint256 _randSeed
    ) external onlyOwner {
        RoundManageInfo storage info = roundManageInfo[_roundId];
        require(info.status == RoundStatus.Drawing, "Round not ready to settle");

        (bool success, ) = managedContracts[uint8(ContractTags.Rng)].call(
            abi.encodeWithSelector(
                bytes4(keccak256("reveal(uint256,uint256)")),
                _roundId,
                _randSeed
            )
        );
        require(success, "RNG: reveal failed");

        info.status = RoundStatus.Claiming;
        info.settledAt = uint64(block.timestamp);

        emit RoundSettled(_roundId);
    }

    /**
     * @notice View current status of a round
     * @param _roundId Round ID
     * @return status Current status of the round
     */
    function getRoundStatus(
        uint256 _roundId
    ) external view returns (RoundStatus status) {
        status = roundManageInfo[_roundId].status;
    }
}
```

## Contract: Rng.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Rng (Random Number Generator) Contract
 * @notice This smart contract is responsible for generating random numbers in rounds.
 * @dev Application of a signature-based algorithm that can verify the integrity of the seed
 * Due to the entropy added in the middle of the round, 
 * even the seed generator cannot infer the final random value.
 * @author hlibbc
 */
contract Rng is EIP712 {
    using ECDSA for bytes32;

    /// constant 정의
    uint256 public constant ENTROPY_FACTOR1 = 6;
    uint256 public constant ENTROPY_FACTOR2 = 16;
    bytes32 public constant SIGDATA_TYPEHASH =
        keccak256("SigData(uint256 roundId,uint256 randSeed)");

    address public mainAddr; // 라운드시작, 종료, 정산을 관장할 컨트랙트
    address public signerAddr; // commit 시 기록될 시그니처 주인

    // 라운드별 기록될 Rng 정보
    struct RoundRngInfo {
        address ender; // 라운드를 종료시킨 참여자
        uint256 blockTime; // 라운드 종료 블록 타임스탬프
        bytes32 salt; // Salt값: 라운드종료 블록의 50블록 이전 해시
        bytes32 finalRands; // 최종 난수 (reveal 이후 확정됨)
        bytes signature; // 라운드 시작 시 입력된 RoundSeedInfo에 대한 signer 서명
    }

    mapping(uint256 => RoundRngInfo) public roundRngInfo; // 라운드별 RngInfo 저장용 매핑변수

    // 이벤트 정의
    event Committed(
        uint256 indexed roundId
    );
    event SealedEntropy(
        uint256 indexed roundId,
        address indexed ender,
        bytes32 salt
    );
    event Revealed(
        uint256 indexed roundId, 
        uint256 indexed seed, 
        bytes32 finalNum
    );

    /**
     * @notice constructor
     */
    constructor(
        address _mainAddr,
        address _signerAddr
    ) EIP712("Custom-Rng", "1") {
        require(_mainAddr != address(0), "Invalid Main address");
        require(_signerAddr != address(0), "Invalid Signer address");
        mainAddr = _mainAddr;
        signerAddr = _signerAddr;
    }

    modifier onlyMain() {
        require(msg.sender == mainAddr, "Not Main contract");
        _;
    }

    /** 
     * @notice Store the signature signed for the data at the start of the round.
     * @dev 
     * Signature data type: 
     * struct SigData {
     *    uint256 roundId;
     *    uint256 seed;
     * }
     */
    function commit(
        uint256 _roundId, 
        bytes calldata _signature
    ) external onlyMain {
        require(roundRngInfo[_roundId].signature.length == 0, "Already committed");
        roundRngInfo[_roundId].signature = _signature;
        emit Committed(_roundId);
    }

    /**
     * @notice Add entropy at the end of the round.
     * @dev List of entropy to be added
     * - ender (address: 20bytes)
     * - salt: keccak256(abi.encodePacked(block.timestamp, blockhash(selectedBlockNum)))
     */
    function sealEntropy(
        uint256 _roundId, 
        address _ender
    ) external onlyMain {
        require(_ender != address(0), "Invalid Ender address");
        require(roundRngInfo[_roundId].signature.length > 0, "Not committed Yet");
        require(roundRngInfo[_roundId].ender == address(0), "Already sealed");

        uint256 selectedBlockNum = (block.number > 50)? (block.number - 50) : (1);
        bytes32 salt = blockhash(selectedBlockNum);
        roundRngInfo[_roundId].blockTime = block.timestamp;
        roundRngInfo[_roundId].salt = salt;
        roundRngInfo[_roundId].ender = _ender;
        emit SealedEntropy(_roundId, _ender, salt);
    }

    /// @notice 라운드 정산 시 reveal (최종 난수 확정)
    function reveal(
        uint256 _roundId, 
        uint256 _randSeed
    ) external onlyMain {
        RoundRngInfo storage info = roundRngInfo[_roundId];

        require(info.finalRands == bytes32(0), "Already revealed");
        require(info.signature.length == 65, "Invalid signature length");

        // EIP-712 hash 생성
        bytes32 structHash = keccak256(abi.encode(
            SIGDATA_TYPEHASH,
            _roundId,
            _randSeed
        ));

        bytes32 digest = _hashTypedDataV4(structHash);

        // 서명 복원
        address recovered = ECDSA.recover(digest, info.signature);
        require(recovered == signerAddr, "Invalid signature");

        // 추가 entropy 생성
        bytes32 entropy1 = (block.number > ENTROPY_FACTOR1)? (blockhash(block.number - ENTROPY_FACTOR1)) : (bytes32(0));
        bytes32 entropy2 = (block.number > ENTROPY_FACTOR2)? (blockhash(block.number - ENTROPY_FACTOR2)) : (bytes32(0));

        // 최종 난수 생성
        bytes32 finalRng = keccak256(
            abi.encodePacked(_randSeed, info.ender, info.salt, entropy1, entropy2)
        );

        info.finalRands = finalRng;
        emit Revealed(_roundId, _randSeed, finalRng);
    }


    /// @notice 라운드별 난수정보 확인
    function getRoundRngInfo(uint256 _roundId) external view returns (
        address ender,
        uint256 blockTime,
        bytes32 salt,
        bytes32 finalRands,
        bytes memory signature
    ) {
        RoundRngInfo storage info = roundRngInfo[_roundId];
        return (
            info.ender,
            info.blockTime,
            info.salt,
            info.finalRands,
            info.signature
        );
    }
}
```

## Tests: Rng.debug.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Rng Contract", function () {
    let rng;
    let main;
    let owner;
    let user1;
    let signer;
    let domain;
    let types;

    beforeEach(async function () {
        [owner, user1, signer] = await ethers.getSigners();

        const Main = await ethers.getContractFactory("Main");
        main = await Main.deploy();
        await main.waitForDeployment();

        const Rng = await ethers.getContractFactory("Rng");
        rng = await Rng.deploy(await main.getAddress(), signer.address);
        await rng.waitForDeployment();

        await main.setContracts([await rng.getAddress()]);

        domain = {
            name: "Custom-Rng",
            version: "1",
            chainId: await ethers.provider.getNetwork().then(net => net.chainId),
            verifyingContract: await rng.getAddress()
        };

        types = {
            SigData: [
                { name: "roundId", type: "uint256" },
                { name: "randSeed", type: "uint256" }
            ]
        };
    });

    describe("초기화", function () {
        it("올바른 주소로 초기화되어야 함", async function () {
            expect(await rng.mainAddr()).to.equal(await main.getAddress());
            expect(await rng.signerAddr()).to.equal(signer.address);
        });

        it("상수값이 올바르게 설정되어야 함", async function () {
            expect(await rng.ENTROPY_FACTOR1()).to.equal(6);
            expect(await rng.ENTROPY_FACTOR2()).to.equal(16);
        });

        it("잘못된 주소로 초기화하면 실패해야 함", async function () {
            const Rng = await ethers.getContractFactory("Rng");
            await expect(
                Rng.deploy(ethers.ZeroAddress, signer.address)
            ).to.be.revertedWith("Invalid Main address");

            await expect(
                Rng.deploy(await main.getAddress(), ethers.ZeroAddress)
            ).to.be.revertedWith("Invalid Signer address");
        });
    });

    describe("commit", function () {
        it("Main 컨트랙트만 호출할 수 있어야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await expect(
                rng.connect(user1).commit(1, signature)
            ).to.be.revertedWith("Not Main contract");
        });

        it("Main 컨트랙트를 통해 커밋이 성공해야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await expect(main.startRound(1, signature))
                .to.emit(rng, "Committed")
                .withArgs(1);

            const info = await rng.getRoundRngInfo(1);
            expect(info.signature).to.equal(signature);
        });

        it("이미 커밋된 라운드는 실패해야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await main.startRound(1, signature);

            await expect(
                main.startRound(1, signature)
            ).to.be.revertedWith("Round already started");
        });
    });

    describe("sealEntropy", function () {
        beforeEach(async function () {
            const signature = "0x" + "1".repeat(130);
            await main.startRound(1, signature);
        });

        it("Main 컨트랙트만 호출할 수 있어야 함", async function () {
            await expect(
                rng.connect(user1).sealEntropy(1, await user1.getAddress())
            ).to.be.revertedWith("Not Main contract");
        });

        it("Main 컨트랙트를 통해 sealEntropy가 성공해야 함", async function () {
            const tx = await main.connect(user1).endRound(1);
            await tx.wait();
            await expect(tx)
                .to.emit(rng, "SealedEntropy");

            const info = await rng.getRoundRngInfo(1);
            expect(info.ender).to.equal(await user1.getAddress());
            expect(info.blockTime).to.be.gt(0);
            expect(info.salt).to.not.equal(ethers.ZeroHash);
        });

        it("커밋되지 않은 라운드는 실패해야 함", async function () {
            await expect(
                main.connect(user1).endRound(2)
            ).to.be.revertedWith("Round not active");
        });

        it("이미 sealed된 라운드는 실패해야 함", async function () {
            await main.connect(user1).endRound(1);

            await expect(
                main.connect(user1).endRound(1)
            ).to.be.revertedWith("Round not active");
        });
    });

    describe("reveal", function () {
        let validSignature;
        let roundId = 1;
        let randSeed = 12345;

        beforeEach(async function () {
            const sigData = { roundId: roundId, randSeed: randSeed };
            validSignature = await signer.signTypedData(domain, types, sigData);

            await main.startRound(roundId, validSignature);
            await main.connect(user1).endRound(roundId);
        });

        it("Main 컨트랙트만 호출할 수 있어야 함", async function () {
            await expect(
                rng.connect(user1).reveal(roundId, randSeed)
            ).to.be.revertedWith("Not Main contract");
        });

        it("Main 컨트랙트를 통해 reveal이 성공해야 함", async function () {
            const tx = await main.settleRound(roundId, randSeed);
            await tx.wait();
            await expect(tx)
                .to.emit(rng, "Revealed");

            const info = await rng.getRoundRngInfo(roundId);
            expect(info.finalRands).to.not.equal(ethers.ZeroHash);
        });

        it("이미 revealed된 라운드는 실패해야 함", async function () {
            await main.settleRound(roundId, randSeed);

            await expect(
                main.settleRound(roundId, randSeed)
            ).to.be.revertedWith("Round not ready to settle");
        });

        it("잘못된 서명으로 실패해야 함", async function () {
            const wrongSignature = "0x" + "2".repeat(130);
            await main.startRound(3, wrongSignature);
            await main.connect(user1).endRound(3);

            await expect(
                main.settleRound(3, randSeed)
            ).to.be.revertedWith("RNG: reveal failed");
        });
    });

    // ... 이하 생략 가능
});
```
