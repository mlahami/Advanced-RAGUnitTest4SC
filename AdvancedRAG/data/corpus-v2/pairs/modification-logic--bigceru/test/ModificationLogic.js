const { expect } = require("chai");
const { ethers } = require("hardhat");

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

describe("ModificationLogic", function () {
  let propertyRegistryProxy, historyTracker;
  let owner, government, government2, professional, professional2, user1, user2, user3;
  let propertyId = 1;

  beforeEach(async function () {
    // Deploy HistoryTracker
    const HistoryTracker = await hre.ethers.getContractFactory("HistoryTracker");
    historyTracker = await HistoryTracker.deploy();
    await historyTracker.waitForDeployment();

    // Deploy ProfileManager
    const ProfileManager = await hre.ethers.getContractFactory("ProfileManager");
    const profileManager = await ProfileManager.deploy();
    await profileManager.waitForDeployment();

    // Deploy TransferLogic
    const TransferLogic = await hre.ethers.getContractFactory("TransferLogic");
    const transferLogic = await TransferLogic.deploy();
    await transferLogic.waitForDeployment();

    // Deploy Registration
    const Registration = await hre.ethers.getContractFactory("Registration");
    const registration = await Registration.deploy();
    await registration.waitForDeployment();

    // Deploy ViewGetFunctions
    const ViewGetFunctions = await hre.ethers.getContractFactory("ViewGetFunctions");
    const viewGetFunctions = await ViewGetFunctions.deploy();
    await viewGetFunctions.waitForDeployment();

    // Deploy ModificationLogic
    const ModificationLogic = await hre.ethers.getContractFactory("ModificationLogic");
    const modificationLogic = await ModificationLogic.deploy();
    await modificationLogic.waitForDeployment();

    // Deploy PropertyRegistry, passing the address of HistoryTracker
    const PropertyRegistry = await hre.ethers.getContractFactory("PropertyRegistry");
    const propertyRegistry = await PropertyRegistry.deploy(historyTracker.target);
    await propertyRegistry.waitForDeployment();

    // #############################
    // # LINK FACETS TO THE FACADE #
    // #############################

    // Function Selector: A unique, 4-byte ID number for a single function.
    // ABI: The complete user manual for the entire contract, describing all its functions and events in detail.

    // Get the selectors for the facets
    const historyTrackerSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("HistoryTracker").abi));
    const profileManagerSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("ProfileManager").abi));
    const transferLogicSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("TransferLogic").abi));
    const viewGetFunctionsSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("ViewGetFunctions").abi));
    const registrationSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("Registration").abi));
    const modificationLogicSelectors = getSelectors(new hre.ethers.Interface(hre.artifacts.readArtifactSync("ModificationLogic").abi));

    // Get the accounts
    [owner, government, government2, professional, professional2, user1, user2, user3] = await ethers.getSigners();

    // Link the facets to the PropertyRegistry (facade)
    await propertyRegistry.connect(owner).addFacet(historyTrackerSelectors, historyTracker.target);
    await propertyRegistry.connect(owner).addFacet(profileManagerSelectors, profileManager.target);
    await propertyRegistry.connect(owner).addFacet(transferLogicSelectors, transferLogic.target);
    await propertyRegistry.connect(owner).addFacet(registrationSelectors, registration.target);;
    await propertyRegistry.connect(owner).addFacet(viewGetFunctionsSelectors, viewGetFunctions.target);
    await propertyRegistry.connect(owner).addFacet(modificationLogicSelectors, modificationLogic.target);

    // # Authorize facets for history tracking #
    let tx = await historyTracker.connect(owner).addAuthorizedLogger(propertyRegistry.target);
    await tx.wait(); // Wait for the transaction to be mined

    // Get the ABIs from all contracts that make up the diamond
    const propertyRegistryABI = hre.artifacts.readArtifactSync("PropertyRegistry").abi;
    const registrationABI = hre.artifacts.readArtifactSync("Registration").abi;
    const profileManagerABI = hre.artifacts.readArtifactSync("ProfileManager").abi;
    const transferLogicABI = hre.artifacts.readArtifactSync("TransferLogic").abi;
    const viewGetFunctionsABI = hre.artifacts.readArtifactSync("ViewGetFunctions").abi;
    const historyTrackerABI = hre.artifacts.readArtifactSync("HistoryTracker").abi
    const modificationLogicABI = hre.artifacts.readArtifactSync("ModificationLogic").abi;

    // Merge them all into a single, de-duplicated ABI
    const combinedABI = mergeABIs([
        propertyRegistryABI,
        registrationABI,
        profileManagerABI,
        transferLogicABI,
        viewGetFunctionsABI,
        historyTrackerABI,
        modificationLogicABI
    ]);

    // Create our single, all-knowing contract object!
    // It points to the proxy's address but uses the combined "super ABI".
    propertyRegistryProxy = new ethers.Contract(propertyRegistry.target, combinedABI, owner);


    // Set government and professional
    await propertyRegistryProxy.connect(owner).addGovernmentEntity(government.address);
    await propertyRegistryProxy.connect(owner).addProfessional(professional.address);

    // Set up a property
    await propertyRegistryProxy.connect(government).registerProperty(
        "9v6r7zxy",
        100,
        "A/2",
        [user1.address], [100], ["ipfsHash1"]
    );
  });

  it("should allow authorized user to initiate a modification", async function () {
    await expect(
      propertyRegistryProxy.connect(government).initiateModification(
        propertyId,
        "ipfsHash2",
        "Update docs",
        0
      )
    ).to.emit(propertyRegistryProxy, "ModificationInitiated")
      .withArgs(propertyId, "ipfsHash2", government.address);
  });

  it("should not allow unauthorized user to initiate a modification", async function () {
    await expect(
      propertyRegistryProxy.connect(user2).initiateModification(
        propertyId,
        "ipfsHash2",
        "Update docs",
        0
      )
    ).to.be.revertedWith("Only authorized entities can perform this action");
  });

  it("should require non-empty IPFS hash and description", async function () {
    await expect(
      propertyRegistryProxy.connect(government).initiateModification(
        propertyId,
        "",
        "desc",
        0
      )
    ).to.be.revertedWith("New IPFS hash must be non-empty.");

    await expect(
      propertyRegistryProxy.connect(government).initiateModification(
        propertyId,
        "ipfsHash2",
        "",
        0
      )
    ).to.be.revertedWith("Description must be non-empty.");
  });

  it("should not allow duplicate modification requests", async function () {
    await propertyRegistryProxy.connect(government).initiateModification(
      propertyId,
      "ipfsHash2",
      "desc",
      0
    );
    await expect(
      propertyRegistryProxy.connect(government).initiateModification(
        propertyId,
        "ipfsHash3",
        "desc2",
        0
      )
    ).to.be.revertedWith("There is already a pending transfer request for this property.");
  });

  it("should allow owner to approve modification", async function () {
    await propertyRegistryProxy.connect(government).initiateModification(
      propertyId,
      "ipfsHash2",
      "desc",
      0
    );
    await expect(
      propertyRegistryProxy.connect(user1).approveModification(propertyId)
    ).to.emit(propertyRegistryProxy, "ModificationDone");
  });

  it("should execute modification when all approvals are collected", async function () {
    await propertyRegistryProxy.connect(government).initiateModification(
      propertyId,
      "ipfsHash2",
      "desc",
      0
    );
    // Owner approves
    await propertyRegistryProxy.connect(user1).approveModification(propertyId);

    // Check property updated
    const prop = await propertyRegistryProxy.getProperty(propertyId);
    expect(prop.ipfsHash[0]).to.equal("ipfsHash2");
  });

  it("should not allow double approval by the same owner", async function () {

    await propertyRegistryProxy.connect(government).registerProperty(
      "1v8r7zcy",
      104,
      "A/2",
      [user1.address, user2.address], [50, 50], ["ipfsHash1"]
    );

    let tempPropertyId = 2; // Update propertyId to the new property

    await propertyRegistryProxy.connect(government).initiateModification(
      tempPropertyId,
      "ipfsHash2",
      "desc",
      0
    );
    await propertyRegistryProxy.connect(user1).approveModification(tempPropertyId);
    await expect(
      propertyRegistryProxy.connect(user1).approveModification(tempPropertyId)
    ).to.be.revertedWith("You have already approved this transfer.");
  });

  it("should not allow approval if no request exists", async function () {
    await expect(
      propertyRegistryProxy.connect(user1).approveModification(propertyId)
    ).to.be.revertedWith("No modification request found for this property.");
  });

  it("should allow government to cancel a modification", async function () {
    await propertyRegistryProxy.connect(government).initiateModification(
      propertyId,
      "ipfsHash2",
      "desc",
      0
    );
    await expect(
      propertyRegistryProxy.connect(government).cancelModification(propertyId)
    ).to.not.be.reverted;

    // Check that the modification request is cleared
    await expect(
      propertyRegistryProxy.connect(user1).approveModification(propertyId)
    ).to.be.revertedWith("No modification request found for this property.");
  });

  it("should not allow cancel if no request exists", async function () {
    await expect(
      propertyRegistryProxy.connect(government).cancelModification(propertyId)
    ).to.be.revertedWith("No modification request to cancel.");
  });

  it("should log changes in HistoryTracker", async function () {
    await propertyRegistryProxy.connect(government).initiateModification(
      propertyId,
      "ipfsHash2",
      "desc",
      0
    );
    await propertyRegistryProxy.connect(user1).approveModification(propertyId);

    // Check history
    const history = await historyTracker.getHistory(propertyId);
    expect(history.length).to.be.greaterThan(0);
    expect(history[0].field).to.include("ipfsHash");
  });
});