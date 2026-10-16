const { expect } = require("chai");
const { ethers } = require("hardhat");

describe('MultiSigVault', () => {
  async function deploy(threshold = 2) {
    const [a, b, c, recipient, attacker] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('MultiSigVault');
    const vault = (await factory.deploy(
      [a .address, b .address, c .address],
      threshold,
    ));
    return {
      vault,
      owners: [a, b, c],
      recipient: recipient,
      attacker: attacker,
    };
  }

  it('rejects an empty owner set', async () => {
    const factory = await ethers.getContractFactory('MultiSigVault');
    await expect(factory.deploy([], 1)).to.be.revertedWithCustomError(factory, 'InvalidConfig');
  });

  it('rejects threshold > owners', async () => {
    const [a] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('MultiSigVault');
    await expect(factory.deploy([a .address], 2)).to.be.revertedWithCustomError(factory, 'InvalidConfig');
  });

  it('rejects duplicate owners', async () => {
    const [a] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('MultiSigVault');
    await expect(factory.deploy([a .address, a .address], 1)).to.be.revertedWithCustomError(
      factory,
      'InvalidConfig',
    );
  });

  it('non-owners cannot submit or confirm', async () => {
    const { vault, attacker } = await deploy();
    await expect(
      vault.connect(attacker).submit(attacker.address, 0, '0x'),
    ).to.be.revertedWithCustomError(vault, 'NotAnOwner');
  });

  it('executes a transaction once threshold is met', async () => {
    const { vault, owners, recipient } = await deploy(2);
    // Fund the vault
    await owners[0] .sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1') });

    // Owner 0 submits + auto-confirms
    const submitTx = await vault.connect(owners[0]).submit(recipient.address, ethers.parseEther('0.5'), '0x');
    await expect(submitTx).to.emit(vault, 'Submitted').to.emit(vault, 'Confirmed');

    // Cannot execute yet (only 1 confirmation, threshold 2)
    await expect(vault.connect(owners[0]).execute(0)).to.be.revertedWithCustomError(
      vault,
      'NotEnoughConfirmations',
    );

    // Owner 1 confirms
    await vault.connect(owners[1]).confirm(0);

    // Now execute
    const before = await ethers.provider.getBalance(recipient.address);
    await expect(vault.connect(owners[0]).execute(0)).to.emit(vault, 'Executed').withArgs(0);
    const after = await ethers.provider.getBalance(recipient.address);
    expect(after - before).to.equal(ethers.parseEther('0.5'));
  });

  it('prevents double execution', async () => {
    const { vault, owners, recipient } = await deploy(2);
    await owners[0] .sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1') });
    await vault.connect(owners[0]).submit(recipient.address, ethers.parseEther('0.1'), '0x');
    await vault.connect(owners[1]).confirm(0);
    await vault.connect(owners[0]).execute(0);
    await expect(vault.connect(owners[1]).execute(0)).to.be.revertedWithCustomError(vault, 'AlreadyExecuted');
  });

  it('allows revoking a confirmation before execution', async () => {
    const { vault, owners, recipient } = await deploy(2);
    await vault.connect(owners[0]).submit(recipient.address, 0, '0x');
    await vault.connect(owners[1]).confirm(0);
    await vault.connect(owners[1]).revokeConfirmation(0);
    await expect(vault.connect(owners[0]).execute(0)).to.be.revertedWithCustomError(
      vault,
      'NotEnoughConfirmations',
    );
  });

  it('cannot revoke after execution', async () => {
    const { vault, owners, recipient } = await deploy(2);
    await owners[0] .sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1') });
    await vault.connect(owners[0]).submit(recipient.address, ethers.parseEther('0.1'), '0x');
    await vault.connect(owners[1]).confirm(0);
    await vault.connect(owners[0]).execute(0);
    await expect(vault.connect(owners[1]).revokeConfirmation(0)).to.be.revertedWithCustomError(
      vault,
      'AlreadyExecuted',
    );
  });

  it('owner set can be replaced via a self-call', async () => {
    const { vault, owners, recipient } = await deploy(2);
    const newOwners = [owners[0] .address, recipient.address];
    const iface = vault.interface;
    const data = iface.encodeFunctionData('setOwners', [newOwners, 1]);
    await vault.connect(owners[0]).submit(await vault.getAddress(), 0, data);
    await vault.connect(owners[1]).confirm(0);
    await vault.connect(owners[0]).execute(0);

    const result = await vault.owners();
    expect(result).to.deep.equal(newOwners);
    expect(await vault.threshold()).to.equal(1);
  });
});
