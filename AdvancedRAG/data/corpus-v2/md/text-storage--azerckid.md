# text-storage--azerckid

- domain: relayer-meta-transactions (meta-transactions)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/azerckid/2025_metaTxSolidity @ 9d503e713c340d677485e9a42254829c01559dae
- license: MIT
- targets: TextStorage.sol, MinimalForwarder.sol
- validation: 6 passing tests, 0 failing; statement coverage TextStorage.sol 100.0 %, MinimalForwarder.sol 94.74 %

## Contract: MinimalForwarder.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @dev OpenZeppelin Contracts v4.9.0 (metatx/MinimalForwarder.sol)
 * https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.9.0/contracts/metatx/MinimalForwarder.sol
 */
contract MinimalForwarder {
    struct ForwardRequest {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        bytes data;
    }

    bytes32 private constant _TYPEHASH =
        keccak256(
            "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data)"
        );

    mapping(address => uint256) private _nonces;

    function getNonce(address from) public view returns (uint256) {
        return _nonces[from];
    }

    function verify(
        ForwardRequest calldata req,
        bytes calldata signature
    ) public view returns (bool) {
        bytes32 hashStruct = keccak256(
            abi.encode(
                _TYPEHASH,
                req.from,
                req.to,
                req.value,
                req.gas,
                req.nonce,
                keccak256(req.data)
            )
        );
        bytes32 digest = _toTypedDataHash(_domainSeparatorV4(), hashStruct);
        address signer = _recoverSigner(digest, signature);
        require(
            _nonces[req.from] == req.nonce,
            "MinimalForwarder: nonce mismatch"
        );
        require(
            signer == req.from,
            "MinimalForwarder: signature does not match request"
        );
        return true;
    }

    function execute(
        ForwardRequest calldata req,
        bytes calldata signature
    ) public payable returns (bool, bytes memory) {
        require(
            verify(req, signature),
            "MinimalForwarder: signature does not match request"
        );
        _nonces[req.from] = req.nonce + 1;
        (bool success, bytes memory returndata) = req.to.call{
            gas: req.gas,
            value: req.value
        }(abi.encodePacked(req.data, req.from));
        assert(gasleft() > req.gas / 63);
        return (success, returndata);
    }

    // --- EIP-712 helpers ---
    function _domainSeparatorV4() internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    keccak256(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                    ),
                    keccak256(bytes("MinimalForwarder")),
                    keccak256(bytes("0.0.1")),
                    block.chainid,
                    address(this)
                )
            );
    }

    function _toTypedDataHash(
        bytes32 domainSeparator,
        bytes32 structHash
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked("\x19\x01", domainSeparator, structHash)
            );
    }

    function _recoverSigner(
        bytes32 hash,
        bytes memory signature
    ) internal pure returns (address) {
        if (signature.length != 65) {
            return address(0);
        }
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        return ecrecover(hash, v, r, s);
    }
}
```

## Contract: TextStorage.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract TextStorage is ERC2771Context {
    mapping(address => string[]) public texts;

    event TextStored(address indexed writer, string text);

    constructor(address trustedForwarder) ERC2771Context(trustedForwarder) {}

    // 메타 트랜잭션을 지원하는 함수
    function storeText(string calldata text) public {
        address sender = _msgSender();
        texts[sender].push(text);
        emit TextStored(sender, text);
    }
}
```

## Tests: TextStorageTest.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TextStorage", function () {
    let textStorage;
    let forwarder;
    let owner;
    let user;

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();

        // MinimalForwarder 배포
        const Forwarder = await ethers.getContractFactory("MinimalForwarder");
        forwarder = await Forwarder.deploy();
        await forwarder.waitForDeployment();

        // TextStorage 배포 (forwarder.target 전달)
        const TextStorage = await ethers.getContractFactory("TextStorage");
        textStorage = await TextStorage.deploy(forwarder.target);
        await textStorage.waitForDeployment();
    });

    it("should store and retrieve text", async function () {
        await textStorage.connect(user).storeText("hello");
        const stored = await textStorage.texts(user.address, 0);
        expect(stored).to.equal("hello");
    });

    it("should store and retrieve multiple texts", async function () {
        await textStorage.connect(user).storeText("first");
        await textStorage.connect(user).storeText("second");
        const first = await textStorage.texts(user.address, 0);
        const second = await textStorage.texts(user.address, 1);
        expect(first).to.equal("first");
        expect(second).to.equal("second");
    });

    it("should emit TextStored event on storeText", async function () {
        await expect(textStorage.connect(user).storeText("eventTest"))
            .to.emit(textStorage, "TextStored")
            .withArgs(user.address, "eventTest");
    });

    // 예외 상황: 빈 문자열 저장 (컨트랙트에서 제한하지 않으면 통과)
    it("should allow storing empty string (unless restricted)", async function () {
        await textStorage.connect(user).storeText("");
        const stored = await textStorage.texts(user.address, 0);
        expect(stored).to.equal("");
    });

    // TODO: Add meta-transaction (forwarder) scenario test
    it("should support meta-transaction via MinimalForwarder (stub)", async function () {
        // 여기에 EIP-2771/메타트랜잭션 시나리오를 추가할 수 있습니다.
        // 실제 구현은 프론트엔드와 연동되는 부분이므로, 서명/relay 로직을 추가로 작성해야 합니다.
        expect(true).to.be.true;
    });

    it("should store text via meta-transaction (EIP-2771)", async function () {
        // 1. ForwardRequest 준비
        const from = user.address;
        const to = textStorage.target;
        const value = 0n;
        const gas = 1_000_000n;
        const nonce = (await forwarder.getNonce(from));
        const data = textStorage.interface.encodeFunctionData("storeText", ["metaTx!"]);

        const req = {
            from,
            to,
            value: value.toString(),
            gas: gas.toString(),
            nonce: nonce.toString(),
            data,
        };

        // 2. EIP-712 도메인 및 타입
        const domain = {
            name: "MinimalForwarder",
            version: "0.0.1",
            chainId: Number((await ethers.provider.getNetwork()).chainId),
            verifyingContract: forwarder.target,
        };
        const types = {
            ForwardRequest: [
                { name: "from", type: "address" },
                { name: "to", type: "address" },
                { name: "value", type: "uint256" },
                { name: "gas", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "data", type: "bytes" },
            ],
        };

        // 3. user가 EIP-712 서명
        const signature = await user.signTypedData(domain, types, req);

        // [디버그] 서명 복구: JS에서 recoverAddress로 검증
        const { TypedDataEncoder, recoverAddress } = ethers;
        const digest = TypedDataEncoder.hash(domain, types, req);
        const recovered = recoverAddress(digest, signature);
        expect(recovered).to.equal(from); // 복구된 주소가 user와 일치해야 함

        // 4. relayer가 execute 호출
        await expect(
            forwarder.connect(owner).execute(req, signature, { gasLimit: Number(gas) })
        ).to.emit(textStorage, "TextStored").withArgs(from, "metaTx!");

        // 5. 저장된 값 확인
        const stored = await textStorage.texts(from, 0);
        expect(stored).to.equal("metaTx!");
    });

    // 추가 테스트: 이벤트, 예외, 여러 저장 등
});
```
