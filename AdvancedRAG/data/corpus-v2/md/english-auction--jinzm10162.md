# english-auction--jinzm10162

- domain: auctions (auction)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/jinzm10162/Gavel @ 4e1f9f4ca2dc54c825bc7344dd8c443848ca6ab2
- license: MIT
- targets: EnglishAuction.sol, EnglishAuctionBase.sol, IEnglishAuction.sol, CallAuction.sol, NFT.sol, Seller.sol
- validation: 35 passing tests, 0 failing; statement coverage EnglishAuction.sol 100.0 %, EnglishAuctionBase.sol 100.0 %, IEnglishAuction.sol 100.0 %, CallAuction.sol 100.0 %, NFT.sol 100.0 %, Seller.sol 100.0 %

## Contract: CallAuction.sol (dependency)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./EnglishAuction.sol";
import "./NFT.sol";
contract CallAuction {
    constructor() payable{}

    function call(
        address target,
        address operator,
        address from,
        uint tokenId,
        bytes calldata data
    ) external {
        IERC721Receiver(target).onERC721Received(
            operator,
            from,
            tokenId,
            data
        );
    }
}
```

## Contract: EnglishAuction.sol (primary target)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./EnglishAuctionBase.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";


contract EnglishAuction is EnglishAuctionBase{
    bytes4 constant public IERC721_ID = 0x80ac58cd;
    uint constant public BUFFER_TIME = 10 minutes;
    
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4) {
        if(msg.sender.code.length == 0) revert InvalidNFT();
        try IERC165(msg.sender).supportsInterface(IERC721_ID) returns (bool res) {
            if(!res) revert InvalidNFT();
            _createAuction(from, msg.sender, tokenId, data, operator);
        } catch {
            revert InvalidNFT();
        }

        return this.onERC721Received.selector;
    }

    function bid(uint nftIndex) 
        external 
        payable 
        nftExists(nftIndex)
    {   
        State currentState = nftState(nftIndex);
        if(currentState == State.NotStarted) revert NotStarted();
        if(currentState != State.Ongoing) revert Ended();

        Auction storage auction = auctions[nftIndex];
        if(auction.seller == msg.sender) revert InvalidBid();
        if(msg.value < auction.currentPrice) revert InvalidBid();
        
        if(auction.highestBidder == address(0)) {
            auction.currentPrice = uint96(msg.value);
            auction.highestBidder = msg.sender;
            refund[nftIndex] = Refund(msg.sender, msg.value);

            emit Bid(nftIndex, msg.sender, msg.value);
            return;
        }

        uint minValue = auction.currentPrice/10 + auction.currentPrice;
        if(auction.currentPrice == 0) minValue = 1;
        if(msg.value < minValue) revert InvalidBid();

        auction.currentPrice =uint96(msg.value);
        auction.highestBidder = msg.sender;

        balance[refund[nftIndex].bidder] += refund[nftIndex].value;
        refund[nftIndex] = Refund(msg.sender, msg.value);

        emit Bid(nftIndex, msg.sender, msg.value);
    }

    function settle(uint nftIndex) 
        external
        nftExists(nftIndex)
    {
        State currentState = nftState(nftIndex);
        if(currentState == State.NotStarted) revert NotStarted();
        if(currentState == State.Ongoing) revert NotOver();
        if(currentState != State.Ended) revert Disposed();
        
        Auction memory auction = auctions[nftIndex];
        if(auction.highestBidder == address(0)){
            state[nftIndex] = State.Unsold;
            IERC721(auction.nftAddr).safeTransferFrom(
                address(this), auction.seller, auction.tokenId
            );
            
            emit Unsold(nftIndex);
            return;
        }

        state[nftIndex] = State.Sold;
        IERC721(auction.nftAddr).safeTransferFrom(
            address(this), auction.highestBidder, auction.tokenId
        );

        (bool success,) = auction.seller.call{value: auction.currentPrice}("");
        if(!success) balance[auction.seller] += auction.currentPrice;

        emit Sold(nftIndex, auction.highestBidder, auction.currentPrice);
    }


    function withdraw() external {
        if(balance[msg.sender] == 0) revert InvalidWithdrawal();
        uint _balance = balance[msg.sender];
        balance[msg.sender] = 0;

        (bool success,) = msg.sender.call{value: _balance}("");
        if(!success) revert WithdrawFailed();

        emit Withdraw(msg.sender, _balance);
    }

    function nftState(uint nftIndex) 
        public
        view
        nftExists(nftIndex)
        returns(State)
    {
        State currentState = state[nftIndex]; 

        if(currentState == State.Sold || currentState == State.Unsold) {
            return currentState;
        }
        
        Auction memory auction = auctions[nftIndex];
        uint startTime = auction.startTime;
        uint endTime = auction.endTime;
      
        if(block.timestamp >= startTime && block.timestamp < endTime) {
            currentState = State.Ongoing;
            return currentState;
        }
        
        if(block.timestamp >= endTime) {
            currentState = State.Ended;
            return currentState;
        }

        return currentState;
    }

    function _createAuction(
       address seller,
       address nftAddr,
       uint tokenId,
       bytes calldata data,
       address operator
    ) internal {
        if(data.length != 96) revert InvalidData();

        (uint40 startTime, uint40 endTime, uint96 startPrice) = abi.decode(
            data, 
            (uint40, uint40, uint96)
        );

        if(startTime <= block.timestamp + BUFFER_TIME) revert InvalidTime();
        if(endTime <= startTime) revert InvalidTime();
        if(startPrice == 0) revert InvalidPrice();

        auctions.push(Auction(
            tokenId,
            seller, 
            startPrice,
            nftAddr,
            startTime,
            endTime,
            address(0)
        ));
        emit AuctionCreated(
            seller,
            nftAddr,
            tokenId, 
            auctions.length -1,
            startTime, 
            endTime, 
            startPrice,
            operator
        );
    }
}
```

## Contract: EnglishAuctionBase.sol (dependency)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./IEnglishAuction.sol";


abstract contract EnglishAuctionBase is IEnglishAuction {
    struct Auction {
        uint tokenId;

        address seller;
        uint96 currentPrice;

        address nftAddr;
        uint40 startTime;
        uint40 endTime;
        
        address highestBidder;
    }

    struct Refund {
        address bidder;
        uint value;
    }

    Auction[] public auctions;
    mapping(uint nftIndex => Refund) internal refund;
    mapping(uint nftIndex => State) internal state;
    mapping(address => uint) public balance;
    
    modifier nftExists(uint nftIndex) {
        if(nftIndex >= auctions.length) revert InvalidNFTIndex();
        _;
    }
}
```

## Contract: IEnglishAuction.sol (dependency)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @title On-chain English auction for ERC-721 tokens
/// @notice Sellers escrow an NFT, bidders compete with ascending bids until a deadline, and the
/// winner takes the token while the seller takes the proceeds.
/// @dev There is no `createAuction` entry point. An auction is opened through `onERC721Received`:
/// the seller calls `safeTransferFrom(seller, auction, tokenId, data)` on their NFT with `data` set
/// to `abi.encode(uint40 startTime, uint40 endTime, uint96 startPrice)`. Escrow and listing are
/// therefore a single atomic step, and the contract never needs an approval of its own.
///
/// Value leaves through `withdraw` rather than being pushed during settlement. Outbid amounts are
/// credited rather than refunded on the spot, and proceeds that cannot be delivered to the seller
/// are credited too, so neither a reverting bidder nor a reverting seller can block an auction.
interface IEnglishAuction is IERC721Receiver {
    /// @notice Lifecycle of a single auction.
    /// @dev `Ongoing` and `Ended` are derived from the block timestamp on every read rather than
    /// written; only the terminal states are stored. An auction sits in `Ended` from its deadline
    /// until someone calls `settle`, which moves it to `Sold` or `Unsold` for good.
    enum State {
        NotStarted,
        Ongoing,
        Ended,
        Sold,
        Unsold
    }

    /// @notice Emitted when an NFT is escrowed and its auction registered.
    /// @param seller The account that owned the NFT and will receive the proceeds.
    /// @param nftAddr The ERC-721 contract the token belongs to.
    /// @param tokenId The escrowed token.
    /// @param nftIndex The auction's index, used by every other entry point.
    /// @param startTime When bidding opens.
    /// @param endTime When bidding closes.
    /// @param startPrice The reserve price the first bid must meet.
    /// @param operator The account that initiated the transfer, which may differ from the seller.
    event AuctionCreated(
        address seller,
        address indexed nftAddr,
        uint indexed tokenId,
        uint indexed nftIndex,
        uint startTime,
        uint endTime,
        uint startPrice,
        address operator
    );

    /// @notice Emitted on every accepted bid.
    /// @param nftIndex The auction bid on.
    /// @param bidder The new highest bidder.
    /// @param price The new highest price.
    event Bid(uint indexed nftIndex, address indexed bidder, uint price);

    /// @notice Emitted when an auction settles with a winner.
    /// @param nftIndex The auction settled.
    /// @param bidder The winner, who now holds the NFT.
    /// @param price The winning price.
    event Sold(uint indexed nftIndex, address indexed bidder, uint price);

    /// @notice Emitted when an auction settles with no bids and the NFT returns to the seller.
    /// @param nftIndex The auction settled.
    event Unsold(uint indexed nftIndex);

    /// @notice Emitted when an account withdraws its credited balance.
    /// @param withdrawer The account paid.
    /// @param value The amount paid out.
    event Withdraw(address indexed withdrawer, uint value);

    /// @notice Thrown when a listing opens too soon, or ends before it starts.
    /// @dev Bidding must open at least a fixed buffer after the escrow transaction, so an auction
    /// cannot be created and won inside the same block.
    error InvalidTime();

    /// @notice Thrown when a listing sets a reserve price of zero.
    error InvalidPrice();

    /// @notice Thrown when the caller of `onERC721Received` has no code, or does not report ERC-721
    /// support through ERC-165.
    error InvalidNFT();

    /// @notice Thrown when an auction index has never been assigned.
    error InvalidNFTIndex();

    /// @notice Thrown when the transfer payload is not exactly the three encoded listing parameters.
    error InvalidData();

    /// @notice Thrown when bidding on or settling an auction that has not opened yet.
    error NotStarted();

    /// @notice Thrown when bidding after the deadline.
    error Ended();

    /// @notice Thrown when the seller bids on their own auction, when a bid misses the reserve, or
    /// when it fails to clear the required increment over the standing bid.
    error InvalidBid();

    /// @notice Thrown when withdrawing with nothing credited.
    error InvalidWithdrawal();

    /// @notice Thrown when settling before the deadline has passed.
    error NotOver();

    /// @notice Thrown when settling an auction that has already been settled.
    error Disposed();

    /// @notice Thrown when the outbound transfer in `withdraw` fails, which reverts the call and
    /// leaves the balance untouched.
    error WithdrawFailed();

    /// @notice The current state of an auction.
    /// @dev Returns the stored terminal state if one was written, otherwise derives the state from
    /// the listing's time window. Reverts on an unknown index.
    /// @param nftIndex The auction to inspect.
    /// @return The auction's state.
    function nftState(uint nftIndex) external returns (State);

    /// @notice Places a bid, paying the amount as `msg.value`.
    /// @dev The first bid must reach the reserve price; every later bid must clear the standing
    /// price by at least ten percent, which keeps an auction from being dragged out by one-wei
    /// increments. The seller may not bid. The amount standing before this bid is credited to its
    /// bidder for later withdrawal rather than returned inline, so a bidder that rejects incoming
    /// ETH cannot block the auction by being outbid.
    /// @param nftIndex The auction to bid on.
    function bid(uint nftIndex) external payable;

    /// @notice Closes an auction once its deadline has passed. Callable by anyone.
    /// @dev With no bids the NFT returns to the seller and the auction becomes `Unsold`. With a
    /// winner the NFT goes to the highest bidder and the auction becomes `Sold`. Payment to the
    /// seller is attempted inline and credited to their balance if it fails, so a seller contract
    /// without a payable fallback cannot strand the NFT in escrow.
    /// @param nftIndex The auction to settle.
    function settle(uint nftIndex) external;

    /// @notice Pays out the caller's credited balance.
    /// @dev Covers both outbid amounts and seller proceeds that could not be delivered during
    /// settlement. The balance is zeroed before the transfer.
    function withdraw() external;
}
```

## Contract: NFT.sol (dependency)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract NFT is ERC721 {
    uint private nextId;

    event Mint(address to, uint tokenId);

    constructor() ERC721("MyNFT", "MNFT") {}

    function mint(address to) external {
        uint tokenId = nextId ++;
       
        _safeMint(to, tokenId);
        emit Mint(to, tokenId);
    }
}
```

## Contract: Seller.sol (dependency)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract Seller is IERC721Receiver {
    address _operator;
    address _from;
    uint _tokenId;
    bytes _data;

    bool _switch;

    modifier Switch() {
        require(_switch);
        _;
    }

    function change(bool a) external {
        _switch = a;
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4) {
        _operator = operator;
        _from = from;
        _tokenId = tokenId;
        _data = data;

        return this.onERC721Received.selector;
    }

    receive() external payable Switch {}
}
```

## Tests: EnglishAuction.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { 
    loadFixture, 
    time,
    impersonateAccount,
    setBalance
} = require("@nomicfoundation/hardhat-network-helpers");

describe("EnglishAuction合约测试", ()=>{
    let owner, owner2, owner3;
    let englishAuction, nft, callAuction, seller, impersonateSigner;

    before(async()=>{
        [
            owner, owner2, owner3
        ] = await ethers.getSigners();
    });

    async function Deploy() {
        const EnglishAuction = await ethers.getContractFactory("EnglishAuction");
        const NFT = await ethers.getContractFactory("NFT");
        const CallAuction = await ethers.getContractFactory("CallAuction");
        const Seller = await ethers.getContractFactory("Seller");
        const englishAuction = await EnglishAuction.deploy();
        const nft = await NFT.deploy();
        const callAuction = await CallAuction.deploy();
        const seller = await Seller.deploy();

        const address = await seller.getAddress();
        const depositValue = ethers.parseEther("1");
    
        await impersonateAccount(address);
        const impersonateSigner = await ethers.getSigner(address);
        await setBalance(address, depositValue);
        return { englishAuction, nft, callAuction, seller, impersonateSigner};
    }

    beforeEach(async()=>{
        ({ englishAuction, nft, callAuction, seller, impersonateSigner } = await loadFixture(Deploy));
    });

    async function getEvmTime() {
        const blockNumber = await ethers.provider.getBlockNumber();
        const block = await ethers.provider.getBlock(blockNumber);
        return BigInt(block.timestamp);
    }

    function getEncodeData(startTime, endTime, price = 100n) {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const encodeData = abiCoder.encode(
            ["uint40", "uint40", "uint96"],
            [startTime, endTime, price]
        );
        return encodeData;
    }
    
    async function CreatAuction(isWait, from, encodeData, to, tokenId = 0n) {
        await nft.mint(from);
        const tx = await nft[
            "safeTransferFrom(address,address,uint256,bytes)"
        ](from, to, tokenId, encodeData);
        
        if(isWait) await tx.wait(); 

        return tx;
    }

    describe("#onERC721Received", ()=>{
        it("fail: 非NFT合约调用", async()=>{
            const auctionAddress = await englishAuction.getAddress();
            const creatAuction = callAuction
            .call(auctionAddress, owner.address, owner.address, 2, "0x");
            
            await expect(creatAuction).to.be.
            revertedWithCustomError(
                englishAuction, "InvalidNFT"
            );
        });

        it("fail: EOA账户调用", async()=>{
            const creatAuction = englishAuction
            .onERC721Received(owner.address, owner.address, 2, "0x");
            
            await expect(creatAuction).to.be.
            revertedWithCustomError(
                englishAuction, "InvalidNFT"
            );
        });

        it("fail: data.length !=96", async()=>{
            const address = await englishAuction.getAddress();
            await expect(
                CreatAuction(false, owner.address, "0x1234", address)
            ).to.be.revertedWithCustomError(
                englishAuction, "InvalidData" 
            );
        });

        it("fail: startTime<block.timestamp+bufferTime", async()=>{
            const time = await getEvmTime();
            const startTime = time - 10n;
            const endTime = time + 100n;
            const data = getEncodeData(startTime, endTime);
            const address = await englishAuction.getAddress();
            await expect(
                CreatAuction(false, owner.address, data, address)
            ).to.be.revertedWithCustomError(
                englishAuction, "InvalidTime"
            );
        });
        
        it("fail: startTime>=endTime", async()=>{
            const bufferTime = BigInt(10*60);
            const startTime = await getEvmTime() + 20n + bufferTime;
            const endTime = await getEvmTime() + 10n;
            const data = getEncodeData(startTime, endTime);
            const address = await englishAuction.getAddress();
            await expect(
                CreatAuction(false, owner.address, data, address)
            ).to.be.revertedWithCustomError(
                englishAuction, "InvalidTime"
            );
        });

        it("fail: price=0", async()=>{
            const bufferTime = BigInt(10*60);
            const startTime = await getEvmTime() + 10n + bufferTime;
            const endTime = await getEvmTime() + 100n + bufferTime;
            const data = getEncodeData(startTime, endTime, 0n);
            const address = await englishAuction.getAddress();
            await expect(
                CreatAuction(false, owner, data, address)
            ).to.be.revertedWithCustomError(
                englishAuction, "InvalidPrice"
            );
        });

        it("success: NFT合约合法数据转移NFT", async()=>{
            const bufferTime = BigInt(10*60);
            const startTime = await getEvmTime() + 10n + bufferTime;
            const endTime = await getEvmTime() + 100n + bufferTime;
            const data = getEncodeData(startTime, endTime);
            const address = await englishAuction.getAddress();
            const nftAddress = await nft.getAddress();
            
            await expect(
                CreatAuction(false, owner.address, data, address)
            ).to.emit(
                englishAuction, "AuctionCreated"
            ).withArgs(
                owner.address,
                nftAddress,
                0,
                0,
                startTime,
                endTime,
                100n,
                owner.address
            );

            expect(await englishAuction.auctions(0n)).to.be.deep.equal([
                0n,
                owner.address,
                100n,
                nftAddress,
                startTime,
                endTime,
                ethers.ZeroAddress
            ]);
        });
    });

    describe("#nftExists", ()=>{
        const nftExistsFunc = [
            {funcName: "bid", getArgs: ()=>[5]},
            {funcName: "settle", getArgs: ()=>[6]},
            {funcName: "nftState", getArgs: ()=>[7]}
        ];

        nftExistsFunc.forEach(({funcName, getArgs})=>{
           it(`fail: ${funcName}不存在NFT序号`, async()=>{
                await expect(
                    englishAuction[funcName](...getArgs())
                ).to.be.revertedWithCustomError(
                    englishAuction, "InvalidNFTIndex"
                );
            })
        });
    });

    async function NotStarted() {
        const bufferTime = BigInt(10*60);
        const startTime = await getEvmTime() + 100n + bufferTime;
        const endTime = await getEvmTime() + 1000n + bufferTime;
        const data = getEncodeData(startTime, endTime);
        const address = await englishAuction.getAddress();

        await CreatAuction(true, owner.address, data, address);
    }

    async function Ongoing() {
        const bufferTime = BigInt(10*60);
        const startTime = await getEvmTime() + 100n + bufferTime;
        const endTime = await getEvmTime() + 1000n + bufferTime;
        const data = getEncodeData(startTime, endTime);
        const address = await englishAuction.getAddress();

        await CreatAuction(true, owner.address, data, address);
        await time.increase(800n);
    }

    async function Ended() {
        const bufferTime = BigInt(10*60);
        const startTime = await getEvmTime() + 100n + bufferTime;
        const endTime = await getEvmTime() + 1000n + bufferTime;
        const data = getEncodeData(startTime, endTime);
        const address = await englishAuction.getAddress();

        await CreatAuction(true, owner.address, data, address);
        await time.increase(1700n);
    }

    async function Sold() {
        await Ongoing();
        await englishAuction.connect(owner2).bid(0n, {value: 100n});
        await time.increase(1700n);
        await englishAuction.settle(0n);
    }

    async function Unsold() {
        await Ended();
        await englishAuction.settle(0n);
    }

    describe("nftState", async()=>{
        it("success: startTime>block.timestamp",async()=>{
            await NotStarted();

            expect(
                await englishAuction.nftState.staticCall(0n)
            ).to.equal(0n);
        });

        it("success: startTime<=block.timestamp<endTime", async()=>{
            await Ongoing();

            expect(
                await englishAuction.nftState.staticCall(0n)
            ).to.equal(1n);
        });

        it("success: block.timestamp>=endTime,且没有结算", async()=>{
            await Ended();
            expect(
                await englishAuction.nftState.staticCall(0n)
            ).to.equal(2n);
        });

        it("success: NFT成交之后",async()=>{
            await Sold();
            expect(
                await englishAuction.nftState.staticCall(0n)
            ).to.equal(3n);
        });

        it("success: NFT流拍之后",async()=>{
            await Unsold();
            expect(
                await englishAuction.nftState.staticCall(0n)
            ).to.equal(4n);
        });
    });

    describe("#bid", ()=>{
        it("fail: 状态是NotStarted", async()=>{
            await NotStarted();

            await expect(
                englishAuction.connect(owner2).bid(0n, {value: 200n})
            ).to.be.revertedWithCustomError(
                englishAuction, "NotStarted"
            );
        });

        it("fail: 状态是Ended", async()=>{
            await Ended();

            await expect(
                englishAuction.connect(owner2).bid(0n, {value: 200n})
            ).to.be.revertedWithCustomError(
                englishAuction, "Ended"
            );
        })

        it("fail: 状态是Sold", async()=>{
            await Sold();

            await expect(
                englishAuction.connect(owner2).bid(0n, {value: 200n})
            ).to.be.revertedWithCustomError(
                englishAuction, "Ended"
            );
        });

        it("fail: 状态是Unsold", async()=>{
            await Unsold();

            await expect(
                englishAuction.connect(owner2).bid(0n, {value: 200n})
            ).to.be.revertedWithCustomError(
                englishAuction, "Ended"
            );
        });

        it("fail: seller竞价", async()=>{
            await Ongoing();

            await expect(
                englishAuction.bid(0n, {value: 800n})
            ).to.be.revertedWithCustomError(
                englishAuction, "InvalidBid"
            );
        });

        it("fail: msg.value<startPrice", async()=>{
            await Ongoing();

            await expect(
                englishAuction.connect(owner2).bid(0n, {value: 80n})
            ).to.be.revertedWithCustomError(
                englishAuction, "InvalidBid"
            );
        });

        it("fail: 首次出价之后的出价<currentPrice + startPrice*10%", async()=>{
            await Ongoing();

            await englishAuction.connect(owner2).bid(0n, {value: 100n});
            await expect(
                englishAuction.connect(owner3).bid(0n, {value: 101n})
            ).to.be.revertedWithCustomError(
                englishAuction, "InvalidBid"
            );
        });

        it("success: 合法首次出价", async()=>{
            await Ongoing();

            await expect(
                englishAuction.connect(owner2).bid(0n, {value: 100n})
            ).to.emit(englishAuction, "Bid").withArgs(0n, owner2.address, 100n);

            const auction = await englishAuction.auctions(0n);
            expect(auction.currentPrice).to.equal(100n);
            expect(auction.highestBidder).to.equal(owner2.address);
        });

        it("success: 合法首次出价之后的出价", async()=>{
            await Ongoing();
            await englishAuction.connect(owner2).bid(0n, {value: 100n});
            await expect(
                englishAuction.connect(owner2).bid(0n, {value: 110n})
            ).to.emit(englishAuction, "Bid").withArgs(0n, owner2.address, 110n);

            const auction = await englishAuction.auctions(0n);
            expect(auction.currentPrice).to.equal(110n);
            expect(auction.highestBidder).to.equal(owner2.address);

            expect(await englishAuction.balance(owner2.address)).to.equal(100n);
        });
    });

    describe("#settle", ()=>{
        it("fail: 状态是NotStarted", async()=>{
            await NotStarted();

            await expect(
                englishAuction.settle(0n)
            ).to.be.revertedWithCustomError(
                englishAuction, "NotStarted"
            );
        });

        it("fail: 状态是Ongoing", async()=>{
            await Ongoing();

            await expect(
                englishAuction.settle(0n)
            ).to.be.revertedWithCustomError(
                englishAuction, "NotOver"
            );
        });

        it("fail: 状态是Sold", async()=>{
            await Sold();

            await expect(
                englishAuction.settle(0n)
            ).to.be.revertedWithCustomError(
                englishAuction, "Disposed"
            );
        });

        it("fail: 状态是Unsolde", async()=>{
            await Unsold();

            await expect(
                englishAuction.settle(0n)
            ).to.be.revertedWithCustomError(
                englishAuction, "Disposed"
            );
        });

        it("success: 合法状态成交且给seller转账成功", async()=>{
            await Ongoing();
            await englishAuction.connect(owner2).bid(0n, {value: 100n});
            await time.increase(1700n);

            const address = await englishAuction.getAddress();
            
            const tx = englishAuction.settle(0n);
            await expect(tx).to.emit(englishAuction, "Sold")
            .withArgs(0n, owner2.address, 100n).and.to.emit(
                nft, "Transfer"
            ).withArgs(address, owner2.address, 0n)
           
            await expect(tx).to.changeEtherBalances(
                [owner, englishAuction],
                [100n, -100n]
            );

            expect(
                await englishAuction.nftState.staticCall(0n)
            ).to.equal(3n);


            expect(
                await nft.ownerOf(0n)
            ).to.equal(owner2.address);
        });

        it("success: 合法状态成交且给seller转账失败", async()=>{
            const bufferTime = BigInt(10*60);
            const startTime = await getEvmTime() + 100n + bufferTime;
            const endTime = await getEvmTime() + 1000n + bufferTime;
            const data = getEncodeData(startTime, endTime);
            const auctionAddress = await englishAuction.getAddress();
            const sellerAddress = await seller.getAddress();

            await nft.mint(sellerAddress);
            const tx1 = await nft.connect(impersonateSigner)[
                "safeTransferFrom(address,address,uint256,bytes)"
            ](sellerAddress, auctionAddress, 0n, data);
            await tx1.wait(); 

            await time.increase(800n);

            await englishAuction.connect(owner2).bid(0n, {value: 100n});
            await time.increase(900n);
            
            const tx2 = englishAuction.settle(0n);
            await expect(tx2).to.emit(englishAuction, "Sold")
            .withArgs(0n, owner2.address, 100n).and.to.emit(
                nft, "Transfer"
            ).withArgs(auctionAddress, owner2.address, 0n);

            expect(
                await englishAuction.nftState.staticCall(0n)
            ).to.equal(3n);

            expect(
                await englishAuction.balance(sellerAddress)
            ).to.equal(100n);

            expect(
                await nft.ownerOf(0n)
            ).to.equal(owner2.address);
        });

        it("success: 合法状态流拍", async()=>{
            await Ended();
            const address = await englishAuction.getAddress();

            await expect(
                englishAuction.settle(0n)
            ).to.emit(englishAuction, "Unsold")
            .withArgs(0n).and.to.emit(
                nft, "Transfer"
            ).withArgs(address, owner.address, 0n);

            expect(
                await englishAuction.nftState.staticCall(0n)
            ).to.equal(4n);

            expect(
                await nft.ownerOf(0n)
            ).to.equal(owner.address);
        });
    });

    describe("#withdraw", ()=>{
        it("fall: 余额为零", async()=>{
            await expect(
                englishAuction.connect(owner2).withdraw()
            ).to.be.revertedWithCustomError(
                englishAuction, "InvalidWithdrawal"
            );
        });

        it("fail: seller提取结算转账失败的资金提取失败", async()=>{
            const bufferTime = BigInt(10*60);
            const startTime = await getEvmTime() + 100n + bufferTime;
            const endTime = await getEvmTime() + 1000n + bufferTime;
            const data = getEncodeData(startTime, endTime);
            const auctionAddress = await englishAuction.getAddress();
            const sellerAddress = await seller.getAddress();

            await nft.mint(sellerAddress);
            const tx1 = await nft.connect(impersonateSigner)[
                "safeTransferFrom(address,address,uint256,bytes)"
            ](sellerAddress, auctionAddress, 0n, data);
            await tx1.wait(); 

            await time.increase(800n);

            await englishAuction.connect(owner2).bid(0n, {value: 100n});
            await time.increase(900n);
            
            await englishAuction.settle(0n);

            await expect(
                englishAuction.connect(impersonateSigner).withdraw()
            ).to.be.revertedWithCustomError(
                englishAuction, "WithdrawFailed"
            );
        });

        it("success: bidder提取所有结算后nft的资金", async()=>{
            await Ongoing();
            await englishAuction.connect(owner2).bid(0n, {value: 100n});
            await englishAuction.connect(owner2).bid(0n, {value: 110n});
            await time.increase(1700n);
            await englishAuction.settle(0n);

            const tx = englishAuction.connect(owner2).withdraw();

            await expect(tx).to.emit(englishAuction, "Withdraw")
            .withArgs(owner2.address, 100n);

            await expect(tx).to.changeEtherBalances(
                [owner2, englishAuction],
                [100n, -100n]
            );
        });

        it("success: seller提取结算转账失败的资金", async()=>{
            const bufferTime = BigInt(10*60);
            const startTime = await getEvmTime() + 100n + bufferTime;
            const endTime = await getEvmTime() + 1000n + bufferTime;
            const data = getEncodeData(startTime, endTime);
            const auctionAddress = await englishAuction.getAddress();
            const sellerAddress = await seller.getAddress();

            await nft.mint(sellerAddress);
            const tx1 = await nft.connect(impersonateSigner)[
                "safeTransferFrom(address,address,uint256,bytes)"
            ](sellerAddress, auctionAddress, 0n, data);
            await tx1.wait(); 

            await time.increase(800n);

            await englishAuction.connect(owner2).bid(0n, {value: 100n});
            await time.increase(900n);
            
            await englishAuction.settle(0n);

            await seller.change(true);

            const tx = englishAuction.connect(impersonateSigner).withdraw();

            await expect(tx).to.emit(englishAuction, "Withdraw")
            .withArgs(sellerAddress, 100n);

            await expect(tx).to.changeEtherBalances(
                [seller, englishAuction],
                [100n, -100n]
            );
        });
    });
});
```
