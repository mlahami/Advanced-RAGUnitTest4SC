# main--hlibbc

- domain: games-lotteries (lottery-commit-reveal)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/hlibbc/solidity-practice @ 9f6fa3709e9815f52e8dbd86b87fbe412836bcfa
- license: MIT
- targets: Main.sol, Rng.sol
- validation: 18 passing tests, 0 failing; statement coverage Main.sol 100.0 %, Rng.sol 91.67 %

## Contract: Main.sol (primary target)

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

## Contract: Rng.sol (dependency)

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

## Tests: Main.debug.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Main Contract", function () {
    let main;
    let rng;
    let owner;
    let user1;
    let user2;
    let signer;

    beforeEach(async function () {
        [owner, user1, user2, signer] = await ethers.getSigners();

        // Main 컨트랙트 배포
        const Main = await ethers.getContractFactory("Main");
        main = await Main.deploy();
        await main.waitForDeployment();

        // Rng 컨트랙트 배포
        const Rng = await ethers.getContractFactory("Rng");
        rng = await Rng.deploy(await main.getAddress(), signer.address);
        await rng.waitForDeployment();

        // Main 컨트랙트에 Rng 컨트랙트 주소 설정
        await main.setContracts([await rng.getAddress()]);
    });

    describe("초기화", function () {
        it("올바른 소유자로 초기화되어야 함", async function () {
            expect(await main.owner()).to.equal(owner.address);
        });

        it("초기 라운드 상태가 NotStarted여야 함", async function () {
            expect(await main.getRoundStatus(1)).to.equal(0); // NotStarted
        });

        it("컨트랙트 주소가 올바르게 설정되어야 함", async function () {
            expect(await main.managedContracts(0)).to.equal(await rng.getAddress());
        });
    });

    describe("setContracts", function () {
        it("소유자만 컨트랙트 주소를 설정할 수 있어야 함", async function () {
            await expect(
                main.connect(user1).setContracts([await rng.getAddress()])
            ).to.be.revertedWithCustomError(main, "OwnableUnauthorizedAccount");
        });

        it("잘못된 컨트랙트 개수로 설정하면 실패해야 함", async function () {
                    await expect(
            main.setContracts([await rng.getAddress(), await user1.getAddress()])
        ).to.be.revertedWith("Incorrect Contract Nums");
        });
    });

    describe("startRound", function () {
        it("소유자만 라운드를 시작할 수 있어야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await expect(
                main.connect(user1).startRound(1, signature)
            ).to.be.revertedWithCustomError(main, "OwnableUnauthorizedAccount");
        });

        it("라운드가 이미 시작된 경우 실패해야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await main.startRound(1, signature);
            
            await expect(
                main.startRound(1, signature)
            ).to.be.revertedWith("Round already started");
        });

        it("라운드 시작이 성공해야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await expect(main.startRound(1, signature))
                .to.emit(main, "RoundStarted")
                .withArgs(1);

            expect(await main.getRoundStatus(1)).to.equal(1); // Proceeding
        });
    });

    describe("endRound", function () {
        beforeEach(async function () {
            const signature = "0x" + "1".repeat(130);
            await main.startRound(1, signature);
        });

        it("누구나 라운드를 종료할 수 있어야 함", async function () {
            await expect(main.connect(user1).endRound(1))
                .to.emit(main, "RoundEnded")
                .withArgs(1, await user1.getAddress());

            expect(await main.getRoundStatus(1)).to.equal(2); // Drawing
        });

        it("라운드가 진행중이 아닌 경우 실패해야 함", async function () {
            await main.connect(user1).endRound(1);
            
            await expect(
                main.endRound(1)
            ).to.be.revertedWith("Round not active");
        });

        it("라운드 종료 시 종료 시간이 기록되어야 함", async function () {
            const tx = await main.connect(user1).endRound(1);
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            
            const roundInfo = await main.roundManageInfo(1);
            expect(roundInfo.endedAt).to.equal(block.timestamp);
        });
    });

    describe("settleRound", function () {
        beforeEach(async function () {
            const signature = "0x" + "1".repeat(130);
            await main.startRound(1, signature);
            await main.connect(user1).endRound(1);
        });

        it("소유자만 라운드를 정산할 수 있어야 함", async function () {
            await expect(
                main.connect(user1).settleRound(1, 12345)
            ).to.be.revertedWithCustomError(main, "OwnableUnauthorizedAccount");
        });

        it("라운드가 개표중이 아닌 경우 실패해야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await main.startRound(2, signature);
            
            await expect(
                main.settleRound(2, 12345)
            ).to.be.revertedWith("Round not ready to settle");
        });

        it("라운드 정산이 성공해야 함", async function () {
            // 유효한 EIP-712 서명 생성
            const domain = {
                name: "Custom-Rng",
                version: "1",
                chainId: await ethers.provider.getNetwork().then(net => net.chainId),
                verifyingContract: await rng.getAddress()
            };

            const types = {
                SigData: [
                    { name: "roundId", type: "uint256" },
                    { name: "randSeed", type: "uint256" }
                ]
            };

            const sigData = { roundId: 5, randSeed: 12345 };
            const signature = await signer.signTypedData(domain, types, sigData);

            await main.startRound(5, signature);
            await main.connect(user1).endRound(5);

            await expect(main.settleRound(5, 12345))
                .to.emit(main, "RoundSettled")
                .withArgs(5);

            expect(await main.getRoundStatus(5)).to.equal(3); // Claiming
        });

        it("라운드 정산 시 정산 시간이 기록되어야 함", async function () {
            // 유효한 EIP-712 서명 생성
            const domain = {
                name: "Custom-Rng",
                version: "1",
                chainId: await ethers.provider.getNetwork().then(net => net.chainId),
                verifyingContract: await rng.getAddress()
            };

            const types = {
                SigData: [
                    { name: "roundId", type: "uint256" },
                    { name: "randSeed", type: "uint256" }
                ]
            };

            const sigData = { roundId: 2, randSeed: 12345 };
            const signature = await signer.signTypedData(domain, types, sigData);

            await main.startRound(2, signature);
            await main.connect(user1).endRound(2);

            const tx = await main.settleRound(2, 12345);
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            
            const roundInfo = await main.roundManageInfo(2);
            expect(roundInfo.settledAt).to.equal(block.timestamp);
        });
    });

    describe("getRoundStatus", function () {
        it("존재하지 않는 라운드는 NotStarted 상태를 반환해야 함", async function () {
            expect(await main.getRoundStatus(999)).to.equal(0); // NotStarted
        });

        it("라운드 상태가 올바르게 반환되어야 함", async function () {
            // 유효한 EIP-712 서명 생성
            const domain = {
                name: "Custom-Rng",
                version: "1",
                chainId: await ethers.provider.getNetwork().then(net => net.chainId),
                verifyingContract: await rng.getAddress()
            };

            const types = {
                SigData: [
                    { name: "roundId", type: "uint256" },
                    { name: "randSeed", type: "uint256" }
                ]
            };

            const sigData = { roundId: 3, randSeed: 12345 };
            const signature = await signer.signTypedData(domain, types, sigData);
            
            // 시작 전
            expect(await main.getRoundStatus(3)).to.equal(0); // NotStarted
            
            // 시작 후
            await main.startRound(3, signature);
            expect(await main.getRoundStatus(3)).to.equal(1); // Proceeding
            
            // 종료 후
            await main.connect(user1).endRound(3);
            expect(await main.getRoundStatus(3)).to.equal(2); // Drawing
            
            // 정산 후
            await main.settleRound(3, 12345);
            expect(await main.getRoundStatus(3)).to.equal(3); // Claiming
        });
    });

    describe("라운드 라이프사이클 통합 테스트", function () {
        it("전체 라운드 라이프사이가 올바르게 동작해야 함", async function () {
            // 유효한 EIP-712 서명 생성
            const domain = {
                name: "Custom-Rng",
                version: "1",
                chainId: await ethers.provider.getNetwork().then(net => net.chainId),
                verifyingContract: await rng.getAddress()
            };

            const types = {
                SigData: [
                    { name: "roundId", type: "uint256" },
                    { name: "randSeed", type: "uint256" }
                ]
            };

            const sigData = { roundId: 4, randSeed: 12345 };
            const signature = await signer.signTypedData(domain, types, sigData);
            
            // 1. 라운드 시작
            await expect(main.startRound(4, signature))
                .to.emit(main, "RoundStarted")
                .withArgs(4);
            
            // 2. 라운드 종료
            await expect(main.connect(user1).endRound(4))
                .to.emit(main, "RoundEnded")
                .withArgs(4, await user1.getAddress());
            
            // 3. 라운드 정산
            await expect(main.settleRound(4, 12345))
                .to.emit(main, "RoundSettled")
                .withArgs(4);
            
            // 4. 최종 상태 확인
            const roundInfo = await main.roundManageInfo(4);
            expect(roundInfo.status).to.equal(3); // Claiming
            expect(roundInfo.endedAt).to.be.gt(0);
            expect(roundInfo.settledAt).to.be.gt(0);
        });
    });
});
```
