const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Crowdfunding", function () {
  let crowdfunding, creator, alice, bob;
  const GOAL = ethers.parseEther("10");   // obiettivo: 10 ETH
  const DURATION = 60 * 60 * 24 * 7;       // 7 giorni

  beforeEach(async function () {
    [creator, alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("Crowdfunding");
    crowdfunding = await Factory.deploy();
    // il creatore lancia la campagna 0
    await crowdfunding.connect(creator).createCampaign(GOAL, DURATION, "Campagna test", "Descrizione di prova");
  });

  it("registra correttamente un contributo", async function () {
    await crowdfunding.connect(alice).contribute(0, { value: ethers.parseEther("3") });
    const c = await crowdfunding.campaigns(0);
    expect(c.raised).to.equal(ethers.parseEther("3"));
    expect(await crowdfunding.contributions(0, alice.address)).to.equal(ethers.parseEther("3"));
  });

  it("SCENARIO SUCCESSO: obiettivo raggiunto -> il creatore preleva", async function () {
    await crowdfunding.connect(alice).contribute(0, { value: ethers.parseEther("6") });
    await crowdfunding.connect(bob).contribute(0,   { value: ethers.parseEther("5") }); // tot 11 >= 10

    await time.increase(DURATION + 1); // "viaggio nel tempo": campagna scaduta

    // il prelievo va a buon fine e sposta 11 ETH al creatore
    await expect(crowdfunding.connect(creator).withdraw(0))
      .to.changeEtherBalance(creator, ethers.parseEther("11"));

    const c = await crowdfunding.campaigns(0);
    expect(c.claimed).to.equal(true);
  });

  it("SCENARIO FALLIMENTO: obiettivo non raggiunto -> rimborso ai contributori", async function () {
    await crowdfunding.connect(alice).contribute(0, { value: ethers.parseEther("4") }); // < 10

    await time.increase(DURATION + 1);

    // alice riprende esattamente i suoi 4 ETH
    await expect(crowdfunding.connect(alice).refund(0))
      .to.changeEtherBalance(alice, ethers.parseEther("4"));

    // non puo' farsi rimborsare due volte
    await expect(crowdfunding.connect(alice).refund(0))
      .to.be.revertedWith("Nessun contributo da rimborsare");
  });

  it("ACCESS CONTROL: solo il creatore puo' prelevare", async function () {
    await crowdfunding.connect(alice).contribute(0, { value: ethers.parseEther("11") });
    await time.increase(DURATION + 1);
    await expect(crowdfunding.connect(alice).withdraw(0))
      .to.be.revertedWith("Solo il creatore");
  });

  it("non si puo' prelevare prima della scadenza", async function () {
    await crowdfunding.connect(alice).contribute(0, { value: ethers.parseEther("11") });
    await expect(crowdfunding.connect(creator).withdraw(0))
      .to.be.revertedWith("Campagna ancora attiva");
  });

  it("non si puo' contribuire dopo la scadenza", async function () {
    await time.increase(DURATION + 1);
    await expect(crowdfunding.connect(alice).contribute(0, { value: ethers.parseEther("1") }))
      .to.be.revertedWith("Campagna scaduta");
  });
});