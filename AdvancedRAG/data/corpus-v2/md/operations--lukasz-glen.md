# operations--lukasz-glen

- domain: fungible-tokens (storage-library)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/lukasz-glen/hashless-tokens @ 18a5ae1a65f6ec2b27b4b1349f4b93f8b5905538
- license: MIT
- targets: Operations.sol
- validation: 8 passing tests, 0 failing; statement coverage Operations.sol 100.0 %

## Contract: Operations.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library Operations {
    function saveString(string memory str, uint256 slot_) internal {
        assembly {
            let len := mload(str)
            switch len
            case 0 {
                sstore(slot_, 0x0)
            }
            default {
                switch lt(len, 0x20) 
                case 0 {
                    sstore(slot_, add(shl(0x1, len), 0x1))
                    let str_ptr := 0x20
                    let p := 0x1
                    for {  } lt(str_ptr ,len) {  } {
                        sstore(add(slot_, p), mload(add(str, str_ptr)))
                        str_ptr := add(str_ptr, 0x20)
                        p := add(p, 0x1)
                    }
                    let str_data := mload(add(str, str_ptr))
                    // just in case, clear trailing data in memory
                    str_data := and(str_data, shl(shl(3, sub(str_ptr, len)), 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff))
                    sstore(add(slot_, p), str_data)
                }
                default {
                    let str_data := mload(add(str, 0x20))
                    // just in case, clear trailing data in memory
                    str_data := and(str_data, shl(shl(3, sub(0x20, len)), 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff))
                    sstore(slot_, or(str_data, shl(0x1, len)))
                }
            }
        }
    }

    function  loadString(uint256 slot_) internal view returns (string memory str) {
        assembly {
            let first := sload(slot_)
            switch and(0x1, first)
            case 0 {
                str := mload(0x40)
                // Note that Solidity generated IR code reserves memory offset ``0x60`` as well, but a pure Yul object is free to use memory as it chooses.
                if iszero(str) {
                    str := 0x60
                }
                mstore(0x40, add(str, 0x40))

                let len := shr(1, and(first, 0xff))
                mstore(str, len)
                // additionally clear trailing data in storage
                mstore(add(str, 0x20), and(first, shl(shl(3, sub(0x20, len)), 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff)))
            }
            default {
                let len := shr(1, first)
                let words := shr(0x5, add(len, 0x1f))

                str := mload(0x40)
                // Note that Solidity generated IR code reserves memory offset ``0x60`` as well, but a pure Yul object is free to use memory as it chooses.
                if iszero(str) {
                    str := 0x60
                }
                mstore(0x40, add(add(str, 0x20), shl(0x5, words)))

                mstore(str, len)
                for { let i := 0x1 } lt(i, words) { i := add(i, 0x1) } {
                    mstore(add(str, shl(0x5, i)), sload(add(slot_, i)))
                }
                // additionally clear trailing data in storage
                mstore(add(str, shl(0x5, words)), and(sload(add(slot_, words)), shl(sub(shl(0x8, words), shl(0x3, len)), 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff)))
            }
        }
    }
}
```

## Contract: OperationsMock.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Operations} from "./Operations.sol";

contract OperationsMock {
    function saveString(string memory str, uint256 slot_) external {
        Operations.saveString(str, slot_);
    }

    function  loadString(uint256 slot_) external view returns (string memory str) {
        return Operations.loadString(slot_);
    }
}
```

## Tests: Operations.test.js

```javascript
const { ethers } = require('hardhat');
const { expect } = require('chai');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

describe('Operations', function () {
  const fixture = async () => {
    const operations = await ethers.deployContract("OperationsMock");
    return { operations };
  };

  beforeEach(async function () {
    Object.assign(this, await loadFixture(fixture));
  });

  it('saves null string', async function () {
    const str = "";
    await this.operations.saveString(str, 0xffff);
    expect(await this.operations.loadString(0xffff)).to.equal(str);
  });
  
  it('saves short string', async function () {
    const str = "ABCDE";
    await this.operations.saveString(str, 0xffff);
    expect(await this.operations.loadString(0xffff)).to.equal(str);
  });
  
  it('saves 31 bytes string', async function () {
    const str = "ABCDEFGHIJABCDEFGHIJABCDEFGHIJ1";
    await this.operations.saveString(str, 0xffff);
    expect(await this.operations.loadString(0xffff)).to.equal(str);
  });

  it('saves 32 bytes string', async function () {
    const str = "ABCDEFGHIJABCDEFGHIJABCDEFGHIJ12";
    await this.operations.saveString(str, 0xffff);
    expect(await this.operations.loadString(0xffff)).to.equal(str);
  });

  it('saves long string', async function () {
    const str = "ABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJ";
    await this.operations.saveString(str, 0xffff);
    expect(await this.operations.loadString(0xffff)).to.equal(str);
  });

  it('does not override next string 1', async function () {
    const str1 = "";
    const str2 = "FGHIJ";
    await this.operations.saveString(str2, 0x10000);
    await this.operations.saveString(str1, 0xffff);
    await this.operations.saveString(str2, 0x10000);
    expect(await this.operations.loadString(0xffff)).to.equal(str1);
    expect(await this.operations.loadString(0x10000)).to.equal(str2);
  });

  it('does not override next string 2', async function () {
    const str1 = "ABCDE";
    const str2 = "FGHIJ";
    await this.operations.saveString(str2, 0x10001);
    await this.operations.saveString(str1, 0xffff);
    await this.operations.saveString(str2, 0x10001);
    expect(await this.operations.loadString(0xffff)).to.equal(str1);
    expect(await this.operations.loadString(0x10001)).to.equal(str2);
  });

  it('does not override next string 3', async function () {
    const str1 = "ABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJ";
    const str2 = "FGHIJ";
    await this.operations.saveString(str2, 0x10003);
    await this.operations.saveString(str1, 0xffff);
    await this.operations.saveString(str2, 0x10003);
    expect(await this.operations.loadString(0xffff)).to.equal(str1);
    expect(await this.operations.loadString(0x10003)).to.equal(str2);
  });
});
```
