const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("JackVesting", function () {
    let owner;
    let jackToken;
    let jackVesting;

    beforeEach(async function () {
        [owner] = await ethers.getSigners();
        jackToken = await ethers.deployContract("JACK");

        jackVesting = await ethers.deployContract("JackVesting", [
            jackToken.target,
        ]);
    });

    it("Add vesting Success", async function () {

        await jackToken.approve(
            jackVesting.target,
            ethers.parseUnits("10000", "ether")
        );

        await jackToken.mint(
            owner.address,
            ethers.parseUnits("10000", "ether")
        );

        //1 hour from now
        let until = parseInt(new Date().valueOf() / 1000 + 3600);

        await expect(
            jackVesting.addVesting(
                owner.address,
                ethers.parseUnits("10000", "ether"),
                until,
                0
            )
        ).to.not.be.reverted;
    });

    it("Add vesting Error not approved", async function () {
        //1 hour from now
        let until = parseInt(new Date().valueOf() / 1000 + 3600);

        await expect(
            jackVesting.addVesting(
                owner.address,
                ethers.parseUnits("10000", "ether"),
                until,
                0
            )
        ).to.be.reverted;
    });

    it("Add vesting Error balance", async function () {
        await jackToken.approve(
            jackVesting.target,
            ethers.parseUnits("10000", "ether")
        );

        await jackToken.mint(owner.address, ethers.parseUnits("1000", "ether"));

        //1 hour from now
        let until = parseInt(new Date().valueOf() / 1000 + 3600);

        await expect(
            jackVesting.addVesting(
                owner.address,
                ethers.parseUnits("10000", "ether"),
                until,
                0
            )
        ).to.be.reverted;
    });

    it("Claim vesting  Error Locked", async function () {

        await jackToken.approve(
            jackVesting.target,
            ethers.parseUnits("10000", "ether")
        );

        await jackToken.mint(
            owner.address,
            ethers.parseUnits("10000", "ether")
        );

        //1 hour from now
        let until = parseInt(parseInt(new Date().valueOf() / 1000 + 3600));
        await jackVesting.addVesting(
            owner.address,
            ethers.parseUnits("10000", "ether"),
            until,
            0
        );

        await expect(jackVesting.claim(0)).to.be.reverted;
    });

    it("Claim vesting  Error Index", async function () {

        await jackToken.approve(
            jackVesting.target,
            ethers.parseUnits("10000", "ether")
        );

        await jackToken.mint(
            owner.address,
            ethers.parseUnits("10000", "ether")
        );

        //1 hour from now
        let until = parseInt(parseInt(new Date().valueOf() / 1000 + 3600));
        await jackVesting.addVesting(
            owner.address,
            ethers.parseUnits("10000", "ether"),
            until,
            0
        );

        await expect(jackVesting.claim(1)).to.be.reverted;
    });

    it("Claim vesting Error Allredy claimed", async function () {
        await jackToken.approve(
            jackVesting.target,
            ethers.parseUnits("10000", "ether")
        );

        await jackToken.mint(
            owner.address,
            ethers.parseUnits("10000", "ether")
        );

        //1 hour from now
        let until = parseInt(parseInt(new Date().valueOf() / 1000 + 3600));
        await jackVesting.addVesting(
            owner.address,
            ethers.parseUnits("10000", "ether"),
            until,
            0
        );
        await time.increaseTo(parseInt(new Date().valueOf() / 1000 + 3601));
        await jackVesting.claim(0);
        await expect(jackVesting.claim(0)).to.be.reverted;
    });

    it("Claim vesting", async function () {

        await jackToken.approve(
            jackVesting.target,
            ethers.parseUnits("10000", "ether")
        );

        await jackToken.mint(
            owner.address,
            ethers.parseUnits("10000", "ether")
        );

        //1 hour from now
        let until = parseInt(parseInt(new Date().valueOf() / 1000 + 13600));
        await jackVesting.addVesting(
            owner.address,
            ethers.parseUnits("10000", "ether"),
            until,
            0
        );

        await time.increaseTo(parseInt(new Date().valueOf() / 1000 + 13601));
        await expect(jackVesting.claim(0)).to.not.be.reverted;
    });
});
