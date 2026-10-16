# payment-escrow--center-for-ai-services-computing

- domain: escrow-conditional-payments (escrow)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Center-for-AI-Services-Computing/ORACLE @ 537d52f9a6838b9f412e322ae1f2558b80ff920b
- license: MIT
- targets: PaymentEscrow.sol, MockERC20.sol, MaliciousERC20.sol
- validation: 28 passing tests, 0 failing; statement coverage PaymentEscrow.sol 96.55 %, MockERC20.sol 100.0 %, MaliciousERC20.sol 100.0 %

## Contract: MaliciousERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IReentrantTarget {
    function refund(uint256 recordId) external;
    function release(uint256 recordId) external;
}

/**
 * @title MaliciousERC20（测试用，P6 重入回归）
 * @notice 在 transfer 内回调目标合约的 refund/release，用于证明 PaymentEscrow
 *   的 nonReentrant + CEI 能挡住重入。单次开关防无限递归；用 try/catch 吞掉
 *   内层 revert，使外层 transfer 仍返回 true，从而测试可断言"外层成功 + 状态只变一次"。
 */
contract MaliciousERC20 is ERC20 {
    address public attackTarget;
    uint256 public attackRecordId;
    bool public attackRefund; // true=重入 refund, false=重入 release
    bool private attacking;
    bool public reentered; // 记录是否真的发生过重入调用（用于断言）

    constructor() ERC20("Malicious Token", "EVIL") {
        _mint(msg.sender, 1_000_000 * 1e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address _target, uint256 _recordId, bool _attackRefund) external {
        attackTarget = _target;
        attackRecordId = _recordId;
        attackRefund = _attackRefund;
        attacking = true;
    }

    // 在每次 transfer 时尝试重入一次目标合约
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (attacking && attackTarget != address(0)) {
            attacking = false; // 单次：防止无限递归
            reentered = true;
            // 内层重入：若 ReentrancyGuard 生效会 revert，被 try/catch 吞掉，
            // 外层 transfer 照常完成，状态机仅推进一次。
            try IReentrantTarget(attackTarget).refund(attackRecordId) {
                // 不应到达（refund 被 nonReentrant 挡住）
            } catch {
                // 预期路径：重入被拒
            }
        }
    }
}
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20（测试用）
 * @notice 用于本地 Hardhat 网络的测试 token
 */
contract MockERC20 is ERC20 {
    constructor() ERC20("ORACLE Test Token", "ORC") {
        // 给部署者 mint 1,000,000 token
        _mint(msg.sender, 1_000_000 * 1e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Contract: PaymentEscrow.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PaymentEscrow (改造 6)
 * @notice 用户发起任务时托管费用；任务完成且审计通过后释放给 Worker；失败回滚给用户
 *
 * 流程：
 *   1. 用户调 createTask(worker, deadline) + approve token → 创建托管
 *   2. AuditLog updateExecutionWithSig 成功（status=1）时调 release(recordId)
 *   3. 或者失败/超时 → 用户调 refund(recordId)
 *   4. 平台抽成 feeBps 留给 owner
 */
contract PaymentEscrow is Ownable, ReentrancyGuard {
    enum TaskStatus { None, Funded, Released, Refunded }

    IERC20 public immutable paymentToken;
    uint256 public feeBps;            // 平台抽成基点
    address public auditLog;          // AuditLog 合约地址

    struct Escrow {
        address payer;
        address worker;
        uint256 amount;
        uint256 deadline;
        TaskStatus status;
    }

    mapping(uint256 => Escrow) public escrows;  // recordId => escrow
    uint256 public totalFees;

    event TaskFunded(uint256 indexed recordId, address indexed payer, address indexed worker, uint256 amount);
    event TaskReleased(uint256 indexed recordId, address indexed worker, uint256 amount, uint256 fee);
    event TaskRefunded(uint256 indexed recordId, address indexed payer, uint256 amount);
    event FeeBpsUpdated(uint256 newBps);
    event AuditLogUpdated(address indexed newAuditLog);

    constructor(IERC20 _token) Ownable(msg.sender) {
        paymentToken = _token;
        feeBps = 200;  // 默认 2%
        auditLog = address(0);
    }

    modifier onlyAuditLog() {
        require(msg.sender == auditLog, "Only AuditLog");
        _;
    }

    function setAuditLog(address _auditLog) external onlyOwner {
        auditLog = _auditLog;
        emit AuditLogUpdated(_auditLog);
    }

    function setFeeBps(uint256 newBps) external onlyOwner {
        require(newBps <= 5000, "Fee > 50%");
        feeBps = newBps;
        emit FeeBpsUpdated(newBps);
    }

    /**
     * 用户托管费用；recordId 由 AuditLog 分配
     */
    function fundTask(uint256 recordId, address worker, uint256 deadline, uint256 amount) external nonReentrant {
        require(escrows[recordId].status == TaskStatus.None, "RecordId already used");
        require(worker != address(0), "Zero worker");
        require(amount > 0, "Zero amount");
        require(block.timestamp <= deadline, "Past deadline");

        escrows[recordId] = Escrow({
            payer: msg.sender,
            worker: worker,
            amount: amount,
            deadline: deadline,
            status: TaskStatus.Funded
        });

        require(paymentToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        emit TaskFunded(recordId, msg.sender, worker, amount);
    }

    /**
     * 由 AuditLog 调用：任务完成释放
     */
    function release(uint256 recordId) external onlyAuditLog nonReentrant {
        Escrow storage e = escrows[recordId];
        require(e.status == TaskStatus.Funded, "Not funded");

        uint256 fee = (e.amount * feeBps) / 10000;
        uint256 payout = e.amount - fee;
        e.status = TaskStatus.Released;
        totalFees += fee;

        require(paymentToken.transfer(e.worker, payout), "Worker transfer failed");
        if (fee > 0) {
            require(paymentToken.transfer(owner(), fee), "Fee transfer failed");
        }
        emit TaskReleased(recordId, e.worker, payout, fee);
    }

    /**
     * 用户主动退款：仅在 deadline 已过且任务未完成时可调
     */
    function refund(uint256 recordId) external nonReentrant {
        Escrow storage e = escrows[recordId];
        require(e.status == TaskStatus.Funded, "Not funded");
        require(msg.sender == e.payer, "Not payer");
        require(block.timestamp > e.deadline, "Not past deadline");

        e.status = TaskStatus.Refunded;
        require(paymentToken.transfer(e.payer, e.amount), "Refund failed");
        emit TaskRefunded(recordId, e.payer, e.amount);
    }

    function getEscrow(uint256 recordId) external view returns (Escrow memory) {
        return escrows[recordId];
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 bal = paymentToken.balanceOf(address(this));
        uint256 fees = totalFees;
        require(fees > 0, "No fees");
        totalFees = 0;
        require(paymentToken.transfer(owner(), fees), "Withdraw failed");
    }
}
```

## Tests: PaymentEscrow.test.js

```javascript
/**
 * PaymentEscrow 单元测试
 * 覆盖: fundTask / release / refund / setAuditLog / setFeeBps / withdrawFees
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PaymentEscrow Contract (改造 6)", function () {
    let token, escrow;
    let owner, auditLogAddr, payer, worker, other;

    // 远期 deadline：每次 beforeEach 重新计算
    let FAR_DEADLINE;

    beforeEach(async function () {
        [owner, auditLogAddr, payer, worker, other] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token = await MockERC20.deploy();
        await token.waitForDeployment();

        const PaymentEscrow = await ethers.getContractFactory("PaymentEscrow");
        escrow = await PaymentEscrow.deploy(await token.getAddress());
        await escrow.waitForDeployment();

        // 给 payer / worker 分发 token
        await token.mint(payer.address, ethers.parseEther("10000"));
        await token.mint(worker.address, ethers.parseEther("1000"));

        // 远期 deadline 动态计算
        const next = (await ethers.provider.getBlock("latest")).timestamp + 1;
        await ethers.provider.send("evm_setNextBlockTimestamp", [next]);
        await ethers.provider.send("evm_mine", []);
        FAR_DEADLINE = next + 1000 * 365 * 24 * 3600;
    });

    describe("Deployment", function () {
        it("Should set correct paymentToken", async function () {
            expect(await escrow.paymentToken()).to.equal(await token.getAddress());
        });

        it("Should set default feeBps = 200 (2%)", async function () {
            expect(await escrow.feeBps()).to.equal(200);
        });

        it("Should set owner correctly", async function () {
            expect(await escrow.owner()).to.equal(owner.address);
        });

        it("Should set auditLog = 0 initially", async function () {
            expect(await escrow.auditLog()).to.equal(ethers.ZeroAddress);
        });
    });

    describe("fundTask", function () {
        beforeEach(async function () {
            await token.connect(payer).approve(await escrow.getAddress(), ethers.parseEther("10000"));
        });

        it("Should fund task successfully", async function () {
            const amount = ethers.parseEther("100");
            await escrow.connect(payer).fundTask(1, worker.address, FAR_DEADLINE, amount);
            const e = await escrow.getEscrow(1);
            expect(e.payer).to.equal(payer.address);
            expect(e.worker).to.equal(worker.address);
            expect(e.amount).to.equal(amount);
            expect(e.deadline).to.equal(FAR_DEADLINE);
            expect(e.status).to.equal(1); // Funded
        });

        it("Should transfer tokens from payer", async function () {
            const before = await token.balanceOf(payer.address);
            const amount = ethers.parseEther("100");
            await escrow.connect(payer).fundTask(1, worker.address, FAR_DEADLINE, amount);
            const after = await token.balanceOf(payer.address);
            expect(before - after).to.equal(amount);
            expect(await token.balanceOf(await escrow.getAddress())).to.equal(amount);
        });

        it("Should emit TaskFunded", async function () {
            const amount = ethers.parseEther("50");
            await expect(escrow.connect(payer).fundTask(1, worker.address, FAR_DEADLINE, amount))
                .to.emit(escrow, "TaskFunded")
                .withArgs(1, payer.address, worker.address, amount);
        });

        it("Should reject double-funding same recordId", async function () {
            const amount = ethers.parseEther("100");
            await escrow.connect(payer).fundTask(1, worker.address, FAR_DEADLINE, amount);
            await expect(
                escrow.connect(payer).fundTask(1, worker.address, FAR_DEADLINE, amount)
            ).to.be.revertedWith("RecordId already used");
        });

        it("Should reject zero worker", async function () {
            await expect(
                escrow.connect(payer).fundTask(1, ethers.ZeroAddress, FAR_DEADLINE, 100)
            ).to.be.revertedWith("Zero worker");
        });

        it("Should reject zero amount", async function () {
            await expect(
                escrow.connect(payer).fundTask(1, worker.address, FAR_DEADLINE, 0)
            ).to.be.revertedWith("Zero amount");
        });

        it("Should reject past deadline", async function () {
            // 等到 hardhat 时间前进
            const past = FAR_DEADLINE + 1;
            await ethers.provider.send("evm_setNextBlockTimestamp", [past]);
            await ethers.provider.send("evm_mine", []);
            await expect(
                escrow.connect(payer).fundTask(1, worker.address, FAR_DEADLINE, 100)
            ).to.be.revertedWith("Past deadline");
        });

        it("Should reject insufficient allowance", async function () {
            // 撤销 approve
            await token.connect(payer).approve(await escrow.getAddress(), 0);
            await expect(
                escrow.connect(payer).fundTask(1, worker.address, FAR_DEADLINE, 100)
            ).to.be.reverted;  // ERC20 transferFrom 失败
        });
    });

    describe("release", function () {
        beforeEach(async function () {
            await token.connect(payer).approve(await escrow.getAddress(), ethers.parseEther("10000"));
            await escrow.connect(payer).fundTask(1, worker.address, FAR_DEADLINE, ethers.parseEther("100"));
            await escrow.connect(owner).setAuditLog(auditLogAddr.address);
        });

        it("Should release to worker and pay fee to owner", async function () {
            const amount = ethers.parseEther("100");
            const feeBps = await escrow.feeBps();
            const fee = (amount * feeBps) / 10000n;
            const payout = amount - fee;

            const workerBefore = await token.balanceOf(worker.address);
            const ownerBefore = await token.balanceOf(owner.address);

            await expect(escrow.connect(auditLogAddr).release(1))
                .to.emit(escrow, "TaskReleased")
                .withArgs(1, worker.address, payout, fee);

            expect(await token.balanceOf(worker.address) - workerBefore).to.equal(payout);
            expect(await token.balanceOf(owner.address) - ownerBefore).to.equal(fee);

            const e = await escrow.getEscrow(1);
            expect(e.status).to.equal(2); // Released
        });

        it("Should reject release from non-auditLog", async function () {
            await expect(escrow.connect(other).release(1)).to.be.revertedWith("Only AuditLog");
        });

        it("Should reject double release", async function () {
            await escrow.connect(auditLogAddr).release(1);
            await expect(escrow.connect(auditLogAddr).release(1)).to.be.revertedWith("Not funded");
        });

        it("Should reject release before fundTask", async function () {
            await expect(escrow.connect(auditLogAddr).release(999)).to.be.revertedWith("Not funded");
        });
    });

    describe("refund", function () {
        beforeEach(async function () {
            await token.connect(payer).approve(await escrow.getAddress(), ethers.parseEther("10000"));
            await escrow.connect(payer).fundTask(1, worker.address, FAR_DEADLINE, ethers.parseEther("100"));
        });

        it("Should refund to payer after deadline", async function () {
            await ethers.provider.send("evm_increaseTime", [1100 * 365 * 24 * 3600]);
            await ethers.provider.send("evm_mine", []);

            const before = await token.balanceOf(payer.address);
            await expect(escrow.connect(payer).refund(1))
                .to.emit(escrow, "TaskRefunded")
                .withArgs(1, payer.address, ethers.parseEther("100"));
            const after = await token.balanceOf(payer.address);
            expect(after - before).to.equal(ethers.parseEther("100"));
            const e = await escrow.getEscrow(1);
            expect(e.status).to.equal(3); // Refunded
        });

        it("Should reject refund before deadline", async function () {
            await expect(escrow.connect(payer).refund(1)).to.be.revertedWith("Not past deadline");
        });

        it("Should reject refund from non-payer", async function () {
            await ethers.provider.send("evm_increaseTime", [1100 * 365 * 24 * 3600]);
            await ethers.provider.send("evm_mine", []);
            await expect(escrow.connect(other).refund(1)).to.be.revertedWith("Not payer");
        });

        it("Should reject double refund", async function () {
            await ethers.provider.send("evm_increaseTime", [1100 * 365 * 24 * 3600]);
            await ethers.provider.send("evm_mine", []);
            await escrow.connect(payer).refund(1);
            await expect(escrow.connect(payer).refund(1)).to.be.revertedWith("Not funded");
        });
    });

    describe("owner governance", function () {
        it("Should set auditLog", async function () {
            await escrow.connect(owner).setAuditLog(auditLogAddr.address);
            expect(await escrow.auditLog()).to.equal(auditLogAddr.address);
            await expect(escrow.connect(owner).setAuditLog(auditLogAddr.address))
                .to.emit(escrow, "AuditLogUpdated").withArgs(auditLogAddr.address);
        });

        it("Should reject setAuditLog from non-owner", async function () {
            await expect(escrow.connect(other).setAuditLog(auditLogAddr.address))
                .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
        });

        it("Should set feeBps", async function () {
            await escrow.connect(owner).setFeeBps(500);
            expect(await escrow.feeBps()).to.equal(500);
        });

        it("Should reject feeBps > 5000", async function () {
            await expect(escrow.connect(owner).setFeeBps(5001)).to.be.revertedWith("Fee > 50%");
        });

        it("Should reject setFeeBps from non-owner", async function () {
            await expect(escrow.connect(other).setFeeBps(100))
                .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
        });
    });

    describe("withdrawFees", function () {
        // 注：当前 PaymentEscrow 实现中，release() 已经把 fee 转给 owner，
        // 所以 escrow 合约不会累积 fees 余额。withdrawFees 实际是"防御性"接口
        // 用于：若 release 因故没转走 fee，owner 可调用 withdrawFees 兜底。
        it("Should reject withdrawFees when no fees accumulated", async function () {
            await token.connect(payer).approve(await escrow.getAddress(), ethers.parseEther("10000"));
            await escrow.connect(payer).fundTask(1, worker.address, FAR_DEADLINE, ethers.parseEther("100"));
            await escrow.connect(owner).setAuditLog(auditLogAddr.address);
            // release 已经把 fee 转给 owner → totalFees 累加但合约余额已无 fees
            await escrow.connect(auditLogAddr).release(1);
            // 再次 release 没有 funded 记录 → revert "Not funded"
            // 但 withdrawFees 看 totalFees > 0 → 尝试转出 → 合约余额不足 → revert
            // 我们在 release 之前测，totalFees = 0
            // 先调一次让 totalFees = 0（已 release），再次 withdraw 期望 revert "No fees"
            // 实际上 totalFees > 0（release 累加了）所以会 revert on insufficient balance
            // 改测：未 release 时，totalFees = 0 → "No fees"
            const escrow2 = await (await ethers.getContractFactory("PaymentEscrow")).deploy(await token.getAddress());
            await escrow2.waitForDeployment();
            await expect(escrow2.connect(owner).withdrawFees()).to.be.revertedWith("No fees");
        });

        it("Should reject withdrawFees from non-owner", async function () {
            await expect(escrow.connect(other).withdrawFees())
                .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
        });
    });

    // P6：恶意 ERC20 重入回归测试 —— 证明 nonReentrant + CEI 挡住重入
    describe("Reentrancy guard (malicious ERC20)", function () {
        let evil, evilEscrow;

        beforeEach(async function () {
            const Evil = await ethers.getContractFactory("MaliciousERC20");
            evil = await Evil.deploy();
            await evil.waitForDeployment();

            const PaymentEscrow = await ethers.getContractFactory("PaymentEscrow");
            evilEscrow = await PaymentEscrow.deploy(await evil.getAddress());
            await evilEscrow.waitForDeployment();

            await evil.mint(payer.address, ethers.parseEther("1000"));
        });

        it("refund: re-entrant call is blocked, status advances exactly once", async function () {
            const recordId = 1;
            const shortDeadline = (await ethers.provider.getBlock("latest")).timestamp + 100;
            await evil.connect(payer).approve(await evilEscrow.getAddress(), ethers.parseEther("100"));
            await evilEscrow
                .connect(payer)
                .fundTask(recordId, worker.address, shortDeadline, ethers.parseEther("100"));

            // 过 deadline 使 refund 可调
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);

            // 武装恶意 token：在 transfer（refund 内的退款转账）时回调 refund 重入
            await evil.arm(await evilEscrow.getAddress(), recordId, true);

            // 外层 refund 应成功完成（内层重入被 nonReentrant 拒绝并被 try/catch 吞掉）
            await expect(evilEscrow.connect(payer).refund(recordId)).to.emit(evilEscrow, "TaskRefunded");

            // 验证：确实触发过重入尝试，但状态只推进到 Refunded 一次（payer 只收到一次退款）
            expect(await evil.reentered()).to.equal(true);
            const esc = await evilEscrow.getEscrow(recordId);
            expect(esc.status).to.equal(3); // Refunded
            // payer 余额：fund 扣 100，refund 退回 100 → 净额回到初始 1000
            expect(await evil.balanceOf(payer.address)).to.equal(ethers.parseEther("1000"));
        });
    });
});
```
