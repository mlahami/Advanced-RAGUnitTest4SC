# forwarder--siddhant-k08

- domain: relayer-meta-transactions (meta-transactions)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/siddhant-k08/rsk-meta-tx-relayer @ 9d8c20b2b347d14c3f6b14d02221050cd17be830
- license: MIT
- targets: Forwarder.sol, ERC2771Context.sol, ExampleTarget.sol
- validation: 7 passing tests, 0 failing; statement coverage Forwarder.sol 100.0 %, ERC2771Context.sol 33.33 %, ExampleTarget.sol 100.0 %

## Contract: ERC2771Context.sol (dependency)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

abstract contract ERC2771Context {
    address private immutable _trustedForwarder;

    constructor(address trustedForwarder) {
        _trustedForwarder = trustedForwarder;
    }

    function isTrustedForwarder(address forwarder) public view virtual returns (bool) {
        return forwarder == _trustedForwarder;
    }

    function _msgSender() internal view virtual returns (address sender) {
        if (isTrustedForwarder(msg.sender)) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            return msg.sender;
        }
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        if (isTrustedForwarder(msg.sender)) {
            return msg.data[:msg.data.length - 20];
        } else {
            return msg.data;
        }
    }
}
```

## Contract: ExampleTarget.sol (dependency)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ERC2771Context.sol";
import "hardhat/console.sol";

contract ExampleTarget is ERC2771Context {
    mapping(address => uint256) public points;

    event PointsAdded(address indexed user, uint256 amount, uint256 newTotal);

    constructor(address trustedForwarder) ERC2771Context(trustedForwarder) {}

    function addPoints(uint256 amount) public {
        address user = _msgSender();
        points[user] += amount;
        
        console.log("Adding %s points to %s", amount, user);
        
        emit PointsAdded(user, amount, points[user]);
    }

    function getPoints(address user) public view returns (uint256) {
        return points[user];
    }
}
```

## Contract: Forwarder.sol (primary target)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "hardhat/console.sol";

contract Forwarder {
    struct ForwardRequest {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        bytes data;
    }

    bytes32 private constant TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data)"
    );

    bytes32 private immutable DOMAIN_SEPARATOR;

    mapping(address => uint256) private _nonces;

    event MetaTransactionExecuted(
        address indexed from,
        address indexed to,
        uint256 nonce,
        bool success,
        bytes returnData
    );

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("RSKForwarder")),
                keccak256(bytes("0.0.1")),
                block.chainid,
                address(this)
            )
        );
    }

    function getNonce(address from) public view returns (uint256) {
        return _nonces[from];
    }

    function verify(
        ForwardRequest calldata req,
        bytes calldata signature
    ) public view returns (bool) {
        address signer = _recoverSigner(req, signature);
        return _nonces[req.from] == req.nonce && signer == req.from;
    }

    function execute(
        ForwardRequest calldata req,
        bytes calldata signature
    ) public payable returns (bool, bytes memory) {
        require(verify(req, signature), "Forwarder: signature does not match request");

        _nonces[req.from] = req.nonce + 1;

        (bool success, bytes memory returnData) = req.to.call{
            gas: req.gas,
            value: req.value
        }(abi.encodePacked(req.data, req.from));

        if (!success) {
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }

        emit MetaTransactionExecuted(req.from, req.to, req.nonce, success, returnData);

        return (success, returnData);
    }

    function _recoverSigner(
        ForwardRequest calldata req,
        bytes calldata signature
    ) internal view returns (address) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        TYPEHASH,
                        req.from,
                        req.to,
                        req.value,
                        req.gas,
                        req.nonce,
                        keccak256(req.data)
                    )
                )
            )
        );

        require(signature.length == 65, "Forwarder: invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) {
            v += 27;
        }

        require(v == 27 || v == 28, "Forwarder: invalid signature v value");

        return ecrecover(digest, v, r, s);
    }

    function getDomainSeparator() public view returns (bytes32) {
        return DOMAIN_SEPARATOR;
    }
}
```

## Tests: Forwarder.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Forwarder", function () {
  let forwarder;
  let exampleTarget;
  let owner;
  let user;
  let relayer;

  beforeEach(async function () {
    [owner, user, relayer] = await ethers.getSigners();

    const ForwarderFactory = await ethers.getContractFactory("Forwarder");
    forwarder = await ForwarderFactory.deploy();
    await forwarder.waitForDeployment();

    const ExampleTargetFactory = await ethers.getContractFactory("ExampleTarget");
    exampleTarget = await ExampleTargetFactory.deploy(await forwarder.getAddress());
    await exampleTarget.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should deploy with correct domain separator", async function () {
      const domainSeparator = await forwarder.getDomainSeparator();
      expect(domainSeparator).to.not.equal(ethers.ZeroHash);
    });

    it("Should initialize nonces to 0", async function () {
      const nonce = await forwarder.getNonce(user.address);
      expect(nonce).to.equal(0);
    });
  });

  describe("Meta-transactions", function () {
    it("Should execute valid meta-transaction", async function () {
      const nonce = await forwarder.getNonce(user.address);

      const data = exampleTarget.interface.encodeFunctionData("addPoints", [10n]);

      const request = {
        from: user.address,
        to: await exampleTarget.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        data: data,
      };

      const domain = {
        name: "RSKForwarder",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await forwarder.getAddress(),
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

      const signature = await user.signTypedData(domain, types, request);

      await expect(forwarder.connect(relayer).execute(request, signature))
        .to.emit(forwarder, "MetaTransactionExecuted")
        .withArgs(user.address, await exampleTarget.getAddress(), nonce, true, "0x");

      const points = await exampleTarget.getPoints(user.address);
      expect(points).to.equal(10n);

      const newNonce = await forwarder.getNonce(user.address);
      expect(newNonce).to.equal(nonce + 1n);
    });

    it("Should reject invalid signature", async function () {
      const nonce = await forwarder.getNonce(user.address);

      const data = exampleTarget.interface.encodeFunctionData("addPoints", [10n]);

      const request = {
        from: user.address,
        to: await exampleTarget.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        data: data,
      };

      const invalidSignature =
        "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

      await expect(forwarder.connect(relayer).execute(request, invalidSignature)).to.be.revertedWith(
        "Forwarder: signature does not match request",
      );
    });

    it("Should reject replay attacks", async function () {
      const nonce = await forwarder.getNonce(user.address);

      const data = exampleTarget.interface.encodeFunctionData("addPoints", [10n]);

      const request = {
        from: user.address,
        to: await exampleTarget.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        data: data,
      };

      const domain = {
        name: "RSKForwarder",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await forwarder.getAddress(),
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

      const signature = await user.signTypedData(domain, types, request);

      await forwarder.connect(relayer).execute(request, signature);

      await expect(forwarder.connect(relayer).execute(request, signature)).to.be.revertedWith(
        "Forwarder: signature does not match request",
      );
    });
  });

  describe("Verification", function () {
    it("Should verify valid request", async function () {
      const nonce = await forwarder.getNonce(user.address);

      const data = exampleTarget.interface.encodeFunctionData("addPoints", [10n]);

      const request = {
        from: user.address,
        to: await exampleTarget.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        data: data,
      };

      const domain = {
        name: "RSKForwarder",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await forwarder.getAddress(),
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

      const signature = await user.signTypedData(domain, types, request);

      const isValid = await forwarder.verify(request, signature);
      expect(isValid).to.be.true;
    });

    it("Should reject invalid nonce", async function () {
      const nonce = await forwarder.getNonce(user.address);

      const data = exampleTarget.interface.encodeFunctionData("addPoints", [10n]);

      const request = {
        from: user.address,
        to: await exampleTarget.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce + 1n,
        data: data,
      };

      const domain = {
        name: "RSKForwarder",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await forwarder.getAddress(),
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

      const signature = await user.signTypedData(domain, types, request);

      const isValid = await forwarder.verify(request, signature);
      expect(isValid).to.be.false;
    });
  });
});
```
