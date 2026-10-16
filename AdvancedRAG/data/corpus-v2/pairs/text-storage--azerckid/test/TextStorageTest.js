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
