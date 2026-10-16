const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Entity Contract", () => {
  let entity;
  let owner;
  let unauthorized;
  let identity1;
  let identity2;

  const initialEntityName = "TestEntity";

  beforeEach(async () => {
    [owner, unauthorized, identity1, identity2] = await ethers.getSigners();

    const EntityFactory = await ethers.getContractFactory("Entity");
    entity = await EntityFactory.deploy(owner.address, initialEntityName);
  });

  describe("Deployment", () => {
    it("should deploy with correct entity name and authorized caller", async () => {
      expect(await entity.getEntityName()).to.equal(initialEntityName);
    });

    it("should revert if initialized with invalid address or empty name", async () => {
      const EntityFactory = await ethers.getContractFactory("Entity");

      await expect(EntityFactory.deploy(ethers.ZeroAddress, "ValidName")).to.be.revertedWithCustomError(
        entity,
        "__ENTITY_INVALID_ADDRESS_PARAMETER_ERROR",
      );

      await expect(EntityFactory.deploy(owner.address, "")).to.be.revertedWithCustomError(
        entity,
        "__ENTITY_INVALID_PARAMETER_ERROR",
      );
    });
  });

  describe("Entity Name Management", () => {
    it("should allow authorized caller to update entity name", async () => {
      const tx = await entity.updateEntityName("NewName");
      await expect(tx).to.emit(entity, "ENTITY_EntityNameUpdated").withArgs(initialEntityName, "NewName");
      expect(await entity.getEntityName()).to.equal("NewName");
    });

    it("should revert entity name update by unauthorized user", async () => {
      await expect(entity.connect(unauthorized).updateEntityName("NewName")).to.be.revertedWithCustomError(
        entity,
        "__ENTITY_INVALID_ADDRESS_PARAMETER_ERROR",
      );
    });

    it("should revert if new entity name is empty", async () => {
      await expect(entity.updateEntityName("")).to.be.revertedWithCustomError(
        entity,
        "__ENTITY_INVALID_PARAMETER_ERROR",
      );
    });
  });

  describe("Identity Management", () => {
    it("should add a new identity", async () => {
      const tx = await entity.addIdentity(identity1.address, "Alice", "Manager");
      await expect(tx).to.emit(entity, "ENTITY_IdentityAdded").withArgs(identity1.address, "Alice", "Manager");

      const [name, role] = await entity.getIdentity(identity1.address);
      expect(name).to.equal("Alice");
      expect(role).to.equal("Manager");
    });

    it("should not allow duplicate identities", async () => {
      await entity.addIdentity(identity1.address, "Alice", "Manager");
      await expect(entity.addIdentity(identity1.address, "Alice", "Manager")).to.be.revertedWithCustomError(
        entity,
        "__ENTITY_INVALID_PARAMETER_ERROR",
      );
    });

    it("should revert if address is zero", async () => {
      await expect(entity.addIdentity(ethers.ZeroAddress, "Bob", "Admin")).to.be.revertedWithCustomError(
        entity,
        "__ENTITY_INVALID_ADDRESS_PARAMETER_ERROR",
      );
    });

    it("should update existing identity", async () => {
      await entity.addIdentity(identity1.address, "Alice", "Manager");

      const tx = await entity.updateIdentity(identity1.address, "Alicia", "Director");
      await expect(tx).to.emit(entity, "ENTITY_IdentityUpdated").withArgs(identity1.address, "Alicia", "Director");

      const [name, role] = await entity.getIdentity(identity1.address);
      expect(name).to.equal("Alicia");
      expect(role).to.equal("Director");
    });

    it("should revert update on non-existing identity", async () => {
      await expect(entity.updateIdentity(identity1.address, "Alicia", "Director")).to.be.revertedWithCustomError(
        entity,
        "__ENTITY_INVALID_ADDRESS_PARAMETER_ERROR",
      );
    });

    it("should remove identity", async () => {
      await entity.addIdentity(identity1.address, "Alice", "Manager");

      const tx = await entity.removeIdentity(identity1.address);
      await expect(tx).to.emit(entity, "ENTITY_IdentityRemoved").withArgs(identity1.address);

      await expect(entity.getIdentity(identity1.address)).to.be.revertedWithCustomError(
        entity,
        "__ENTITY_INVALID_ADDRESS_PARAMETER_ERROR",
      );
    });

    it("should revert removal of non-existing identity", async () => {
      await expect(entity.removeIdentity(identity1.address)).to.be.revertedWithCustomError(
        entity,
        "__ENTITY_INVALID_ADDRESS_PARAMETER_ERROR",
      );
    });

    it("should revert any write operation by unauthorized caller", async () => {
      await expect(
        entity.connect(unauthorized).addIdentity(identity2.address, "Bob", "Admin"),
      ).to.be.revertedWithCustomError(entity, "__ENTITY_INVALID_ADDRESS_PARAMETER_ERROR");

      await expect(entity.connect(unauthorized).removeIdentity(identity2.address)).to.be.revertedWithCustomError(
        entity,
        "__ENTITY_INVALID_ADDRESS_PARAMETER_ERROR",
      );

      await expect(
        entity.connect(unauthorized).updateIdentity(identity2.address, "Bob", "Admin"),
      ).to.be.revertedWithCustomError(entity, "__ENTITY_INVALID_ADDRESS_PARAMETER_ERROR");
    });
  });

  describe("View and Listing Functions", () => {
    it("should list all account addresses", async () => {
      await entity.addIdentity(await identity1.getAddress(), "Alice", "Manager");
      await entity.addIdentity(await identity2.getAddress(), "Bob", "Engineer");

      const accounts = await entity.listAccounts();
      expect([...accounts]).to.have.members([await identity1.getAddress(), await identity2.getAddress()]);
    });

    it("should list identities with address", async () => {
      await entity.addIdentity(identity1.address, "Alice", "Manager");
      await entity.addIdentity(identity2.address, "Bob", "Engineer");

      const identities = await entity.listIdentitiesWithAddress();
      expect(identities.length).to.equal(2);

      // The contract returns an array of arrays, not array of objects.
      // Map the result to objects for easier assertion.
      const mappedIdentities = identities.map(([account, name, role]) => ({
        account,
        name,
        role,
      }));

      expect(mappedIdentities).to.deep.include.members([
        {
          account: identity1.address,
          name: "Alice",
          role: "Manager",
        },
        {
          account: identity2.address,
          name: "Bob",
          role: "Engineer",
        },
      ]);
    });
  });
});
