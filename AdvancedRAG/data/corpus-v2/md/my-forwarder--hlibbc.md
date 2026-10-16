# my-forwarder--hlibbc

- domain: relayer-meta-transactions (meta-transactions)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/hlibbc/solidity-practice @ 9f6fa3709e9815f52e8dbd86b87fbe412836bcfa
- license: MIT
- targets: MyForwarder.sol, MetaTxReceiver.sol
- validation: 34 passing tests, 0 failing; statement coverage MyForwarder.sol 100.0 %, MetaTxReceiver.sol 65.0 %

## Contract: MetaTxReceiver.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract MetaTxReceiver is ERC2771Context {
    string public message;
    address public lastSender;

    event MessageUpdated(string message, address sender);
    event MetaTxDebug(address realSender, bytes fullData);

    constructor(address forwarder) ERC2771Context(forwarder) {}

    function setMessage(string calldata newMessage) external payable {
        if(keccak256(bytes(newMessage)) == keccak256(bytes("revert1"))) {
            revert("revert1");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert2"))) {
            revert("revert2");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert3"))) {
            revert("revert3");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert4"))) {
            revert("revert4");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert5"))) {
            revert("revert5");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert6"))) {
            revert("revert6");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert7"))) {   
            revert("revert7");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert8"))) {
            revert("revert8");
        } else {
            message = newMessage;
            lastSender = _msgSender();  
            emit MetaTxDebug(_msgSender(), msg.data);
            emit MessageUpdated(newMessage, _msgSender());
        }
    }
    
    function _msgSender() internal view override returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view override returns (bytes calldata) {
        return super._msgData();
    }
}
```

## Contract: MyForwarder.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title MyDefaultForwarder (revert reason bubbling)
 * @notice
 *  - OZ ERC2771Forwarder(v5.3)의 execute를 오버라이드
 *  - 대상 컨트랙트에서 발생한 revert 데이터를 그대로 버블링(revert)
 *  - 가스 포워딩 안전성 체크(EIP-150 관련) 로직을 원본과 동치로 inline
 *
 * @dev
 *  - _validate, _useNonce를 그대로 사용
 *  - 호출 데이터는 ERC-2771 규격대로 suffix(원 서명자 주소)를 붙여 호출:
 *      bytes memory data = abi.encodePacked(request.data, request.from);
 *  - msg.value와 request.value는 일치해야 합니다.
 */
contract MyDefaultForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("MyDefaultForwarder") {}

    /// 편의용(디버깅)
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice 대상 컨트랙트를 직접 call하여 실패 시 원문 revert 데이터를 그대로 재-리버트합니다.
     */
    function execute(ForwardRequestData calldata request)
        public
        payable
        virtual
        override
    {
        // 원본과 동일한 값 일치 검증
        if (msg.value != request.value) {
            revert ERC2771ForwarderMismatchedValue(request.value, msg.value);
        }

        // === 원본의 검증 플로우 재현 ===
        (bool isTrustedByTarget, bool active, bool signerMatch, address signer) = _validate(request);
        if (!isTrustedByTarget) {
            revert ERC2771UntrustfulTarget(request.to, address(this));
        }
        if (!active) {
            revert ERC2771ForwarderExpiredRequest(request.deadline);
        }
        if (!signerMatch) {
            revert ERC2771ForwarderInvalidSigner(signer, request.from);
        }

        // nonce 사용(원본 Nonces 흐름 준수)
        uint256 currentNonce = _useNonce(signer);

        // === 대상 호출 준비 ===
        uint256 reqGas = request.gas;
        address to = request.to;
        uint256 value = request.value;
        // ERC-2771 규격: data || from
        bytes memory data = abi.encodePacked(request.data, request.from);

        // === low-level call로 직접 실행해 returndata 확보 ===
        bool success;
        bytes memory ret;
        uint256 gasLeftAfter;

        assembly {
            // call(gas, to, value, in, insize, out, outsize)
            success := call(reqGas, to, value, add(data, 0x20), mload(data), 0, 0)
            let size := returndatasize()
            ret := mload(0x40)
            mstore(0x40, add(ret, add(size, 0x20)))
            mstore(ret, size)
            returndatacopy(add(ret, 0x20), 0, size)
            gasLeftAfter := gas()
        }

        // === EIP-150 기반 가스 전달 보증 체크(원본 _checkForwardedGas 동치) ===
        // 남은 가스가 req.gas/63 보다 작다면 invalid()로 모든 가스 소모
        if (gasLeftAfter < request.gas / 63) {
            assembly {
                invalid()
            }
        }

        // 원본 이벤트와 동일하게 기록
        emit ExecutedForwardRequest(signer, currentNonce, success);

        // 실패 시 대상의 revert 데이터를 "그대로" 버블링
        if (!success) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        // 성공 시에는 아무 것도 하지 않음(원본과 동일)
    }
}

/**
 * @title MyWhitelistForwarder
 * @author hlibbc
 * @notice Add a whitelist to MyDefaultForwarder
 * @dev You can prevent indiscriminate malicious attacks 
 * by ensuring that only requests from whitelisted contracts are accepted.
 * Whitelist management is performed by the owner.
 *
 * 화이트리스트에 등록된 계약의 요청만 수락하도록 하여 무차별적인 악의적 공격을 방지할 수 있습니다.
 * 화이트리스트 관리는 소유자가 수행합니다.
 */
contract MyWhitelistForwarder is MyDefaultForwarder {
    // === 상태 변수 ===
    mapping(address => bool) public whitelist;
    address public owner;
    
    // === 이벤트 ===
    event WhitelistAdded(address indexed target, address indexed addedBy);
    event WhitelistRemoved(address indexed target, address indexed removedBy);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    
    // === 에러 ===
    error NotWhitelisted(address target);
    error NotOwner();
    error InvalidAddress();
    
    // === 생성자 ===
    constructor() {
        owner = msg.sender;
    }
    
    // === 수정자 ===
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    
    // === whitelist 관리 함수 ===
    
    /**
     * @notice 주소를 whitelist에 추가
     * @param target 추가할 주소
     */
    function addToWhitelist(address target) external onlyOwner {
        if (target == address(0)) revert InvalidAddress();
        whitelist[target] = true;
        emit WhitelistAdded(target, msg.sender);
    }
    
    /**
     * @notice 주소를 whitelist에서 제거
     * @param target 제거할 주소
     */
    function removeFromWhitelist(address target) external onlyOwner {
        if (target == address(0)) revert InvalidAddress();
        whitelist[target] = false;
        emit WhitelistRemoved(target, msg.sender);
    }
    
    /**
     * @notice 여러 주소를 한 번에 whitelist에 추가
     * @param targets 추가할 주소 배열
     */
    function addBatchToWhitelist(address[] calldata targets) external onlyOwner {
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) revert InvalidAddress();
            whitelist[targets[i]] = true;
            emit WhitelistAdded(targets[i], msg.sender);
        }
    }
    
    /**
     * @notice 여러 주소를 한 번에 whitelist에서 제거
     * @param targets 제거할 주소 배열
     */
    function removeBatchFromWhitelist(address[] calldata targets) external onlyOwner {
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) revert InvalidAddress();
            whitelist[targets[i]] = false;
            emit WhitelistRemoved(targets[i], msg.sender);
        }
    }
    
    /**
     * @notice 주소가 whitelist에 등록되어 있는지 확인
     * @param target 확인할 주소
     * @return 등록 여부
     */
    function isWhitelisted(address target) external view returns (bool) {
        return whitelist[target];
    }
    
    // === 소유권 관리 ===
    
    /**
     * @notice 새로운 소유자에게 권한 이전
     * @param newOwner 새로운 소유자 주소
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
    
    /**
     * @notice 소유권 포기 (주의: 되돌릴 수 없음)
     */
    function renounceOwnership() external onlyOwner {
        address oldOwner = owner;
        owner = address(0);
        emit OwnershipTransferred(oldOwner, address(0));
    }
    
    // === execute 함수 오버라이드 ===
    
    /**
     * @notice whitelist 검증을 추가한 execute 함수
     * @param request ForwardRequestData 구조체
     */
    function execute(ForwardRequestData calldata request)
        public
        payable
        override
    {
        // === whitelist 검증 추가 ===
        if (!whitelist[request.to]) {
            revert NotWhitelisted(request.to);
        }
        
        // 부모 클래스의 execute 함수 호출 (revert reason bubbling 포함)
        super.execute(request);
    }
}

/**
 * @title MyPluggableForwarder
 * @author hlibbc
 * @notice Add a pluggable policy mechanism to MyDefaultForwarder
 * @dev This forwarder delegates authorization logic to an external contract
 * that implements a pluggable policy interface.
 * Only requests approved by the connected policy contract are forwarded.
 * The policy contract can be upgraded to reflect dynamic business rules.
 *
 * 이 forwarder는 인증 로직을 외부 정책 계약에 위임합니다.
 * 연결된 정책 계약이 승인한 요청만 forwarding되며,
 * 정책 계약은 업그레이드가 가능하여 유동적인 비즈니스 조건에 유연하게 대응할 수 있습니다.
 */
contract MyPluggableForwarder is MyDefaultForwarder {

}
```

## Tests: MyForwarder.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");


describe("MyDefaultForwarder", function () {
  let forwarder, receiver, user, relayer;
  let domain;

  beforeEach(async function () {
    [user, relayer] = await ethers.getSigners();

    const MyDefaultForwarder = await ethers.getContractFactory("MyDefaultForwarder");
    forwarder = await MyDefaultForwarder.deploy();

    const MetaTxReceiver = await ethers.getContractFactory("MetaTxReceiver");
    receiver = await MetaTxReceiver.deploy(await forwarder.getAddress());

    const net = await user.provider.getNetwork();
    domain = {
      name: "MyDefaultForwarder",
      version: "1",
      chainId: Number(net.chainId), // ethers v6는 bigint -> number 변환 필요
      verifyingContract: await forwarder.getAddress(),
    };
  });

  // EIP-712 타입: nonce 포함, deadline은 uint48 이어야 함
  const EIP712_TYPES = {
    ForwardRequest: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint48" },
      { name: "data", type: "bytes" },
    ],
  };

  async function buildRequestToSend(from, to, value, data, gas = 300_000) {
    const deadline = Math.floor(Date.now() / 1000) + 3600; // +1h
    return {
      from: from.address,
      to,
      value,
      gas,
      deadline,
      data,
      signature: "0x",
    };
  }

  async function signForForwarder(signer, reqToSend) {
    // 서명에는 nonce가 필요하지만, execute에 넘기는 struct에는 넣지 않음
    const nonce = await forwarder.nonces(signer.address);
    const forSigning = {
      from: reqToSend.from,
      to: reqToSend.to,
      value: reqToSend.value,
      gas: reqToSend.gas,
      nonce, // EIP-712에만 포함
      deadline: reqToSend.deadline,
      data: reqToSend.data,
    };
    const signature = await signer.signTypedData(domain, EIP712_TYPES, forSigning);
    return { ...reqToSend, signature };
  }

  // 헬퍼: 명시적 nonce로 서명
    async function signForForwarderWithNonce(signer, reqToSend, explicitNonce) {
        const forSigning = {
        from: reqToSend.from,
        to: reqToSend.to,
        value: reqToSend.value,
        gas: reqToSend.gas,
        nonce: explicitNonce,            // <-- 여기!
        deadline: reqToSend.deadline,
        data: reqToSend.data,
        };
        const signature = await signer.signTypedData(domain, EIP712_TYPES, forSigning);
        return { ...reqToSend, signature };
    }
  

  describe("execute", function () {
    it("executes the meta-tx successfully and updates message", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(forwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.not.be.reverted;

      expect(await receiver.message()).to.equal(message);
    });

    it("reverts on invalid signature", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      req.signature = "0x1234567890abcdef"; // 잘못된 서명

      await expect(forwarder.connect(relayer).execute(req, { gasLimit: 2_000_000 }))
        .to.be.revertedWithCustomError(forwarder, "ERC2771ForwarderInvalidSigner");
    });

    it("reverts on expired request", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      req.deadline = Math.floor(Date.now() / 1000) - 3600; // 지난 시간
      const signed = await signForForwarder(user, req);

      await expect(forwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.be.revertedWithCustomError(forwarder, "ERC2771ForwarderExpiredRequest");
    });

    it("bubbles revert reason from target (revert1)", async function () {
      const data = receiver.interface.encodeFunctionData("setMessage", ["revert1"]);
      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(forwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.be.revertedWith("revert1");
    });

    it("bubbles revert reason from target (revert2)", async function () {
      const data = receiver.interface.encodeFunctionData("setMessage", ["revert2"]);
      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(forwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.be.revertedWith("revert2");
    });

    it("emits ExecutedForwardRequest on success", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(forwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.emit(forwarder, "ExecutedForwardRequest")
        .withArgs(user.address, 0n, true); // signer, nonce, success
    });
  });

  describe("executeBatch", function () {
    it("executes a batch of meta-transactions (both succeed)", async function () {
        const m1 = "Hello 1";
        const m2 = "Hello 2";
        const d1 = receiver.interface.encodeFunctionData("setMessage", [m1]);
        const d2 = receiver.interface.encodeFunctionData("setMessage", [m2]);
      
        const base = await forwarder.nonces(user.address); // N
        const r1Unsigned = await buildRequestToSend(user, await receiver.getAddress(), 0, d1);
        const r2Unsigned = await buildRequestToSend(user, await receiver.getAddress(), 0, d2);
      
        const r1 = await signForForwarderWithNonce(user, r1Unsigned, base);       // N
        const r2 = await signForForwarderWithNonce(user, r2Unsigned, base + 1n);  // N+1 (ethers v6 bigint)
      
        const tx = await forwarder.connect(relayer).executeBatch([r1, r2], ethers.ZeroAddress, { gasLimit: 3_000_000 });
      
        await expect(tx).to.emit(forwarder, "ExecutedForwardRequest").withArgs(user.address, base, true);
        await expect(tx).to.emit(forwarder, "ExecutedForwardRequest").withArgs(user.address, base + 1n, true);
      
        expect(await receiver.message()).to.equal(m2);
    });
      

    it("does NOT revert when one inner call reverts; emits success=false for that item", async function () {
        const m1 = "Hello 1";
        const d1 = receiver.interface.encodeFunctionData("setMessage", [m1]);
        const d2 = receiver.interface.encodeFunctionData("setMessage", ["revert1"]);
      
        const base = await forwarder.nonces(user.address); // N
        const r1Unsigned = await buildRequestToSend(user, await receiver.getAddress(), 0, d1);
        const r2Unsigned = await buildRequestToSend(user, await receiver.getAddress(), 0, d2);
      
        const r1 = await signForForwarderWithNonce(user, r1Unsigned, base);       // N
        const r2 = await signForForwarderWithNonce(user, r2Unsigned, base + 1n);  // N+1
      
        const tx = await forwarder.connect(relayer).executeBatch([r1, r2], ethers.ZeroAddress, { gasLimit: 3_000_000 });
      
        await expect(tx).to.emit(forwarder, "ExecutedForwardRequest").withArgs(user.address, base, true);
        await expect(tx).to.emit(forwarder, "ExecutedForwardRequest").withArgs(user.address, base + 1n, false);
      
        expect(await receiver.message()).to.equal(m1);
    });
      

    it("reverts when msg.value mismatches total requested value", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const r = await signForForwarder(user, await buildRequestToSend(user, await receiver.getAddress(), ethers.parseEther("1"), data));

      await expect(
        forwarder.connect(relayer).executeBatch([r], ethers.ZeroAddress, { value: 0, gasLimit: 2_000_000 })
      ).to.be.revertedWithCustomError(forwarder, "ERC2771ForwarderMismatchedValue");
    });
  });

  describe("domain separator", function () {
    it("returns correct domain separator", async function () {
      const expectedDomain = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "bytes32", "bytes32", "uint256", "address"],
          [
            ethers.keccak256(
              ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
            ),
            ethers.keccak256(ethers.toUtf8Bytes("MyDefaultForwarder")),
            ethers.keccak256(ethers.toUtf8Bytes("1")),
            Number((await user.provider.getNetwork()).chainId),
            await forwarder.getAddress()
          ]
        )
      );
      expect(await forwarder.domainSeparator()).to.equal(expectedDomain);
    });
  });
});

describe("MyWhitelistForwarder", function () {
  let whitelistForwarder, receiver, user, relayer, owner;
  let domain;

  beforeEach(async function () {
    [user, relayer, owner] = await ethers.getSigners();

    const MyWhitelistForwarder = await ethers.getContractFactory("MyWhitelistForwarder");
    whitelistForwarder = await MyWhitelistForwarder.connect(owner).deploy();

    const MetaTxReceiver = await ethers.getContractFactory("MetaTxReceiver");
    receiver = await MetaTxReceiver.deploy(await whitelistForwarder.getAddress());

    const net = await user.provider.getNetwork();
    domain = {
      name: "MyDefaultForwarder",
      version: "1",
      chainId: Number(net.chainId),
      verifyingContract: await whitelistForwarder.getAddress(),
    };
  });

  // EIP-712 타입: nonce 포함, deadline은 uint48 이어야 함
  const EIP712_TYPES = {
    ForwardRequest: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint48" },
      { name: "data", type: "bytes" },
    ],
  };

  async function buildRequestToSend(from, to, value, data, gas = 300_000) {
    const deadline = Math.floor(Date.now() / 1000) + 3600; // +1h
    return {
      from: from.address,
      to,
      value,
      gas,
      deadline,
      data,
      signature: "0x",
    };
  }

  async function signForForwarder(signer, reqToSend) {
    const nonce = await whitelistForwarder.nonces(signer.address);
    const forSigning = {
      from: reqToSend.from,
      to: reqToSend.to,
      value: reqToSend.value,
      gas: reqToSend.gas,
      nonce,
      deadline: reqToSend.deadline,
      data: reqToSend.data,
    };
    const signature = await signer.signTypedData(domain, EIP712_TYPES, forSigning);
    return { ...reqToSend, signature };
  }

  describe("Whitelist Management", function () {
    it("should have correct initial owner", async function () {
      expect(await whitelistForwarder.owner()).to.equal(owner.address);
    });

    it("should allow owner to add address to whitelist", async function () {
      const targetAddress = await receiver.getAddress();
      
      await expect(whitelistForwarder.connect(owner).addToWhitelist(targetAddress))
        .to.emit(whitelistForwarder, "WhitelistAdded")
        .withArgs(targetAddress, owner.address);
      
      expect(await whitelistForwarder.isWhitelisted(targetAddress)).to.be.true;
    });

    it("should allow owner to remove address from whitelist", async function () {
      const targetAddress = await receiver.getAddress();
      
      // 먼저 추가
      await whitelistForwarder.connect(owner).addToWhitelist(targetAddress);
      
      // 제거
      await expect(whitelistForwarder.connect(owner).removeFromWhitelist(targetAddress))
        .to.emit(whitelistForwarder, "WhitelistRemoved")
        .withArgs(targetAddress, owner.address);
      
      expect(await whitelistForwarder.isWhitelisted(targetAddress)).to.be.false;
    });

    it("should allow owner to add multiple addresses to whitelist", async function () {
      const addresses = [await receiver.getAddress(), user.address, relayer.address];
      
      await expect(whitelistForwarder.connect(owner).addBatchToWhitelist(addresses))
        .to.emit(whitelistForwarder, "WhitelistAdded")
        .withArgs(await receiver.getAddress(), owner.address)
        .and.to.emit(whitelistForwarder, "WhitelistAdded")
        .withArgs(user.address, owner.address)
        .and.to.emit(whitelistForwarder, "WhitelistAdded")
        .withArgs(relayer.address, owner.address);
      
      for (const addr of addresses) {
        expect(await whitelistForwarder.isWhitelisted(addr)).to.be.true;
      }
    });

    it("should allow owner to remove multiple addresses from whitelist", async function () {
      const addresses = [await receiver.getAddress(), user.address, relayer.address];
      
      // 먼저 추가
      await whitelistForwarder.connect(owner).addBatchToWhitelist(addresses);
      
      // 제거
      await expect(whitelistForwarder.connect(owner).removeBatchFromWhitelist(addresses))
        .to.emit(whitelistForwarder, "WhitelistRemoved")
        .withArgs(await receiver.getAddress(), owner.address)
        .and.to.emit(whitelistForwarder, "WhitelistRemoved")
        .withArgs(user.address, owner.address)
        .and.to.emit(whitelistForwarder, "WhitelistRemoved")
        .withArgs(relayer.address, owner.address);
      
      for (const addr of addresses) {
        expect(await whitelistForwarder.isWhitelisted(addr)).to.be.false;
      }
    });

    it("should revert when non-owner tries to add to whitelist", async function () {
      const targetAddress = await receiver.getAddress();
      
      await expect(
        whitelistForwarder.connect(user).addToWhitelist(targetAddress)
      ).to.be.revertedWithCustomError(whitelistForwarder, "NotOwner");
    });

    it("should revert when non-owner tries to remove from whitelist", async function () {
      const targetAddress = await receiver.getAddress();
      
      // 먼저 추가
      await whitelistForwarder.connect(owner).addToWhitelist(targetAddress);
      
      // 제거 시도
      await expect(
        whitelistForwarder.connect(user).removeFromWhitelist(targetAddress)
      ).to.be.revertedWithCustomError(whitelistForwarder, "NotOwner");
    });

    it("should revert when trying to add zero address to whitelist", async function () {
      await expect(
        whitelistForwarder.connect(owner).addToWhitelist(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(whitelistForwarder, "InvalidAddress");
    });

    it("should revert when trying to remove zero address from whitelist", async function () {
      await expect(
        whitelistForwarder.connect(owner).removeFromWhitelist(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(whitelistForwarder, "InvalidAddress");
    });
  });

  describe("Ownership Management", function () {
    it("should allow owner to transfer ownership", async function () {
      const newOwner = user.address;
      
      await expect(whitelistForwarder.connect(owner).transferOwnership(newOwner))
        .to.emit(whitelistForwarder, "OwnershipTransferred")
        .withArgs(owner.address, newOwner);
      
      expect(await whitelistForwarder.owner()).to.equal(newOwner);
    });

    it("should allow owner to renounce ownership", async function () {
      await expect(whitelistForwarder.connect(owner).renounceOwnership())
        .to.emit(whitelistForwarder, "OwnershipTransferred")
        .withArgs(owner.address, ethers.ZeroAddress);
      
      expect(await whitelistForwarder.owner()).to.equal(ethers.ZeroAddress);
    });

    it("should revert when non-owner tries to transfer ownership", async function () {
      const newOwner = user.address;
      
      await expect(
        whitelistForwarder.connect(user).transferOwnership(newOwner)
      ).to.be.revertedWithCustomError(whitelistForwarder, "NotOwner");
    });

    it("should revert when non-owner tries to renounce ownership", async function () {
      await expect(
        whitelistForwarder.connect(user).renounceOwnership()
      ).to.be.revertedWithCustomError(whitelistForwarder, "NotOwner");
    });

    it("should revert when trying to transfer ownership to zero address", async function () {
      await expect(
        whitelistForwarder.connect(owner).transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(whitelistForwarder, "InvalidAddress");
    });
  });

  describe("Execute with Whitelist", function () {
    beforeEach(async function () {
      // receiver를 whitelist에 추가
      await whitelistForwarder.connect(owner).addToWhitelist(await receiver.getAddress());
    });

    it("should execute meta-tx successfully when target is whitelisted", async function () {
      const message = "Hello Whitelist";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.not.be.reverted;

      expect(await receiver.message()).to.equal(message);
    });

    it("should revert when target is not whitelisted", async function () {
      // receiver를 whitelist에서 제거
      await whitelistForwarder.connect(owner).removeFromWhitelist(await receiver.getAddress());
      
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(
        whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 })
      ).to.be.revertedWithCustomError(whitelistForwarder, "NotWhitelisted")
        .withArgs(await receiver.getAddress());
    });

    it("should revert when target is never added to whitelist", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, user.address, 0, data); // user.address는 whitelist에 없음
      const signed = await signForForwarder(user, req);

      await expect(
        whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 })
      ).to.be.revertedWithCustomError(whitelistForwarder, "NotWhitelisted")
        .withArgs(user.address);
    });

    it("should maintain revert reason bubbling for whitelisted targets", async function () {
      const data = receiver.interface.encodeFunctionData("setMessage", ["revert1"]);
      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.be.revertedWith("revert1");
    });

    it("should emit ExecutedForwardRequest on successful execution", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.emit(whitelistForwarder, "ExecutedForwardRequest")
        .withArgs(user.address, 0n, true);
    });

    it("should handle value mismatch correctly", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), ethers.parseEther("1"), data);
      const signed = await signForForwarder(user, req);

      await expect(
        whitelistForwarder.connect(relayer).execute(signed, { value: 0, gasLimit: 2_000_000 })
      ).to.be.revertedWithCustomError(whitelistForwarder, "ERC2771ForwarderMismatchedValue");
    });

    it("should handle invalid signature correctly", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      req.signature = "0x1234567890abcdef"; // 잘못된 서명

      await expect(
        whitelistForwarder.connect(relayer).execute(req, { gasLimit: 2_000_000 })
      ).to.be.revertedWithCustomError(whitelistForwarder, "ERC2771ForwarderInvalidSigner");
    });

    it("should handle expired request correctly", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      req.deadline = Math.floor(Date.now() / 1000) - 3600; // 지난 시간
      const signed = await signForForwarder(user, req);

      await expect(
        whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 })
      ).to.be.revertedWithCustomError(whitelistForwarder, "ERC2771ForwarderExpiredRequest");
    });
  });

  describe("Integration Tests", function () {
    it("should work correctly after ownership transfer", async function () {
      // 새로운 소유자에게 권한 이전
      await whitelistForwarder.connect(owner).transferOwnership(user.address);
      
      // 새로운 소유자가 whitelist 관리
      await whitelistForwarder.connect(user).addToWhitelist(await receiver.getAddress());
      
      // 메타트랜잭션 실행
      const message = "Hello New Owner";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(relayer, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(relayer, req);

      await expect(whitelistForwarder.connect(owner).execute(signed, { gasLimit: 2_000_000 }))
        .to.not.be.reverted;

      expect(await receiver.message()).to.equal(message);
    });

    it("should maintain whitelist after ownership renounce", async function () {
      // receiver를 whitelist에 추가
      await whitelistForwarder.connect(owner).addToWhitelist(await receiver.getAddress());
      
      // 소유권 포기
      await whitelistForwarder.connect(owner).renounceOwnership();
      
      // whitelist 상태 유지 확인
      expect(await whitelistForwarder.isWhitelisted(await receiver.getAddress())).to.be.true;
      
      // 메타트랜잭션 실행 (여전히 작동해야 함)
      const message = "Hello After Renounce";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.not.be.reverted;

      expect(await receiver.message()).to.equal(message);
    });
  });
});
```
