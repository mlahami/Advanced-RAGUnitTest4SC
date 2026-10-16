const { expect } = require("chai");
const { ethers } = require("hardhat");
const hre = require("hardhat");

// Helper function to get function selectors from a contract artifact
function getSelectors(contractInterface) {
    const selectors = [];
    contractInterface.forEachFunction((func) => {
        selectors.push(func.selector);
    });
    return selectors;
}

// Helper function to merge ABI arrays and remove any duplicate entries.
function mergeABIs(abis) {
    const combined = abis.flat();
    const uniqueEntries = new Map();

    combined.forEach(item => {
        // Create a unique signature for each ABI entry to handle de-duplication.
        let key;
        if (item.type === 'function') {
            // For functions, the signature must include parameter types to correctly
            // handle function overloading (e.g., myFunction(uint) vs. myFunction(address)).
            const paramTypes = (item.inputs || []).map(i => i.type).join(',');
            key = `function:${item.name}:${paramTypes}`;
        } else {
            // For events and other types, the name is usually sufficient.
            key = `${item.type}:${item.name}`;
        }
        
        // If we haven't seen this signature before, add it to our map.
        if (!uniqueEntries.has(key)) {
            uniqueEntries.set(key, item);
        }
    });

    return Array.from(uniqueEntries.values());
}

describe("PropertyRegistry", function () {
  let propertyRegistryProxy, historyTracker;
  let profileManagerFacet, transferLogicFacet, viewGetFunctionsFacet, registrationFacet;
  let owner, government, government2, professional, professional2, user1, user2, user3;

  beforeEach(async function () {
    // Deploy HistoryTracker
    const HistoryTracker = await hre.ethers.getContractFactory("HistoryTracker");
    historyTracker = await HistoryTracker.deploy();
    await historyTracker.waitForDeployment();
    // console.log("HistoryTracker deployed to:", (await historyTracker.getAddress()).toString());

    // Deploy ProfileStorage
    // const PropertyStorage = await hre.ethers.getContractFactory("PropertyStorage");
    // const propertyStorage = await PropertyStorage.deploy();
    // await propertyStorage.waitForDeployment();
    // console.log("PropertyRegistry deployed to:", (await propertyStorage.getAddress()).toString());

    // Deploy ProfileManager
    const ProfileManager = await hre.ethers.getContractFactory("ProfileManager");
    const profileManager = await ProfileManager.deploy();
    await profileManager.waitForDeployment();
    // console.log("PropertyRegistry deployed to:", (await profileManager.getAddress()).toString());

    // Deploy TransferLogic
    const TransferLogic = await hre.ethers.getContractFactory("TransferLogic");
    const transferLogic = await TransferLogic.deploy();
    await transferLogic.waitForDeployment();
    // console.log("TransferLogic deployed to:", (await transferLogic.getAddress()).toString());

    // Deploy Registration
    const Registration = await hre.ethers.getContractFactory("Registration");
    const registration = await Registration.deploy();
    await registration.waitForDeployment();
    // console.log("TransferLogic deployed to:", (await registration.getAddress()).toString());

    // Deploy ViewGetFunctions
    const ViewGetFunctions = await hre.ethers.getContractFactory("ViewGetFunctions");
    const viewGetFunctions = await ViewGetFunctions.deploy();
    await viewGetFunctions.waitForDeployment();
    // console.log("TransferLogic deployed to:", (await viewGetFunctions.getAddress()).toString());

    // Deploy PropertyRegistry, passing the address of HistoryTracker
    const PropertyRegistry = await hre.ethers.getContractFactory("PropertyRegistry");
    const propertyRegistry = await PropertyRegistry.deploy(historyTracker.target);
    await propertyRegistry.waitForDeployment();
    // console.log("PropertyRegistry deployed to:", (await propertyRegistry.getAddress()).toString());

    // #############################
    // # LINK FACETS TO THE FACADE #
    // #############################

    // Function Selector: A unique, 4-byte ID number for a single function.
    // ABI: The complete user manual for the entire contract, describing all its functions and events in detail.

    // console.log("[2] Linking facets to the PropertyRegistry...");

    // Get the selectors for the facets
    const historyTrackerSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("HistoryTracker").abi));
    const profileManagerSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("ProfileManager").abi));
    const transferLogicSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("TransferLogic").abi));
    const viewGetFunctionsSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("ViewGetFunctions").abi));
    const registrationSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("Registration").abi));

    // Get the accounts
    [owner, government, government2, professional, professional2, user1, user2, user3] = await ethers.getSigners();

    // Link the facets to the PropertyRegistry (facade)
    await propertyRegistry.connect(owner).addFacet(historyTrackerSelectors, historyTracker.target);
    // console.log("HistoryTracker linked successfully.");

    await propertyRegistry.connect(owner).addFacet(profileManagerSelectors, profileManager.target);
    // console.log("ProfileManager linked successfully.");

    await propertyRegistry.connect(owner).addFacet(transferLogicSelectors, transferLogic.target);
    // console.log("TransferLogic linked successfully.");

    await propertyRegistry.connect(owner).addFacet(registrationSelectors, registration.target);
    // console.log("Registration linked successfully.");

    await propertyRegistry.connect(owner).addFacet(viewGetFunctionsSelectors, viewGetFunctions.target);
    // console.log("ViewGetFunctions linked successfully.");

    // console.log("\nLinking complete!");

    // # Authorize facets for history tracking #
    // console.log("Authorizing facets for history tracking...");
    let tx = await historyTracker.connect(owner).addAuthorizedLogger(propertyRegistry.target);
    await tx.wait(); // Wait for the transaction to be mined
    // console.log("TransferLogic authorized for history tracking.");

    // Attach ABIs to the deployed proxy contract address for interaction
    // profileManagerFacet = await ethers.getContractAt("ProfileManager", propertyRegistry.target);
    // transferLogicFacet = await ethers.getContractAt("TransferLogic", propertyRegistry.target);
    // viewGetFunctionsFacet = await ethers.getContractAt("ViewGetFunctions", propertyRegistry.target);
    // registrationFacet = await ethers.getContractAt("Registration", propertyRegistry.target);

    // Get the ABIs from all contracts that make up the diamond
    const propertyRegistryABI = hre.artifacts.readArtifactSync("PropertyRegistry").abi;
    const registrationABI = hre.artifacts.readArtifactSync("Registration").abi;
    const profileManagerABI = hre.artifacts.readArtifactSync("ProfileManager").abi;
    const transferLogicABI = hre.artifacts.readArtifactSync("TransferLogic").abi;
    const viewGetFunctionsABI = hre.artifacts.readArtifactSync("ViewGetFunctions").abi;
    const historyTrackerABI = hre.artifacts.readArtifactSync("HistoryTracker").abi

    // Merge them all into a single, de-duplicated ABI
    const combinedABI = mergeABIs([
        propertyRegistryABI,
        registrationABI,
        profileManagerABI,
        transferLogicABI,
        viewGetFunctionsABI,
        historyTrackerABI
    ]);

    // Create our single, all-knowing contract object!
    // It points to the proxy's address but uses the combined "super ABI".
    propertyRegistryProxy = new ethers.Contract(propertyRegistry.target, combinedABI, owner);
  });

  describe("Roles management", function () {
    it("Owner can add and remove government entities", async function () {
      await propertyRegistryProxy.addGovernmentEntity(government.address);
      expect(await propertyRegistryProxy.isGovernment(government.address)).to.be.true;

      await propertyRegistryProxy.removeGovernmentEntity(government.address);
      expect(await propertyRegistryProxy.isGovernment(government.address)).to.be.false;
    });

    it("Owner can add and remove professionals", async function () {
      await propertyRegistryProxy.addProfessional(professional.address);
      expect(await propertyRegistryProxy.isProfessional(professional.address)).to.be.true;

      await propertyRegistryProxy.removeProfessional(professional.address);
      expect(await propertyRegistryProxy.isProfessional(professional.address)).to.be.false;
    });

    it("Non-owner cannot add or remove government/professional", async function () {
      await expect(
        propertyRegistryProxy.connect(user1).addGovernmentEntity(user2.address)
      ).to.be.revertedWith("Only the contract owner can perform this action");

      await expect(
        propertyRegistryProxy.connect(user1).addProfessional(user2.address)
      ).to.be.revertedWith("Only the contract owner can perform this action");
    });
  });

  describe("Professional authorization", function () {
    let propertyId;
    beforeEach(async function () {
      await propertyRegistryProxy.addGovernmentEntity(government.address);
      const tx = await propertyRegistryProxy.connect(government).registerProperty(
        "9v6r7zxy",
        100,
        "A/2",
        [user1.address],
        [100],
        ["ipfsHash1"]
      );
      await expect(tx).to.emit(propertyRegistryProxy, "PropertyRegistered").withArgs(1, [user1.address]);
      propertyId = 1;
    });

    it("Owner can authorize a professional with payment", async function () {
      const contractOwnerInitialBalance = await ethers.provider.getBalance(owner.address);

      await propertyRegistryProxy.connect(owner).addProfessional(professional.address);
      await expect(
        propertyRegistryProxy.connect(owner).authorizeProfessional(professional.address, propertyId, { value: ethers.parseEther("0.01") })
      ).to.emit(propertyRegistryProxy, "ProfessionalAuthorized").withArgs(professional.address, propertyId);

      // Verify the professional is now authorized
      expect(await propertyRegistryProxy.isAuthorized(professional.address, propertyId)).to.be.true;

      // DO NOT CHECK PAYMENT SINCE THE CONTRACT OWNER PAYED HIMSELF
    });

    it("Professional can pay to get authorization", async function () {
      await propertyRegistryProxy.connect(owner).addProfessional(professional.address);

      // Capture initial balances
      const contractOwnerInitialBalance = await ethers.provider.getBalance(owner.address);
      const professionalInitialBalance = await ethers.provider.getBalance(professional.address);

      // Verify the professional is not authorized
      expect(await propertyRegistryProxy.isAuthorized(professional.address, propertyId)).to.be.false;

      await expect(
        propertyRegistryProxy.connect(professional).authorizeProfessional(professional.address, propertyId, { value: ethers.parseEther("0.01") })
      ).to.emit(propertyRegistryProxy, "ProfessionalAuthorized").withArgs(professional.address, propertyId);

      // Verify the professional is now authorized
      expect(await propertyRegistryProxy.isAuthorized(professional.address, propertyId)).to.be.true;

      // Check balances after payment
      const contractOwnerFinalBalance = await ethers.provider.getBalance(owner.address);
      const professionalFinalBalance = await ethers.provider.getBalance(professional.address);
      expect(contractOwnerFinalBalance).to.equal(contractOwnerInitialBalance + ethers.parseEther("0.01"));
      expect(professionalFinalBalance).to.lessThanOrEqual(professionalInitialBalance - ethers.parseEther("0.01"));  // It can be less due to gas fees
    });

    it("Fails if payment is too low", async function () {
      await propertyRegistryProxy.connect(owner).addProfessional(professional.address);
      await expect(
        propertyRegistryProxy.connect(owner).authorizeProfessional(professional.address, propertyId, { value: ethers.parseEther("0.001") })
      ).to.be.revertedWith("You must pay 0.01 ether to authorize a professional");
    });

    it("Fails if property does not exist", async function () {
      await propertyRegistryProxy.connect(owner).addProfessional(professional.address);
      await expect(
        propertyRegistryProxy.connect(owner).authorizeProfessional(professional.address, 999, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Property does not exist");
    });

    it("Fails if the professional is already authorized", async function () {
      await propertyRegistryProxy.connect(owner).addProfessional(professional.address);
      await propertyRegistryProxy.connect(owner).authorizeProfessional(professional.address, propertyId, { value: ethers.parseEther("0.01") });
      await expect(
        propertyRegistryProxy.connect(owner).authorizeProfessional(professional.address, propertyId, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Professional already authorized for this property");
    });

    it("Fails if the professional is not registered", async function () {
      await expect(
        propertyRegistryProxy.connect(owner).authorizeProfessional(user2.address, propertyId, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Only authorized entities can perform this action");
    });
  });

});