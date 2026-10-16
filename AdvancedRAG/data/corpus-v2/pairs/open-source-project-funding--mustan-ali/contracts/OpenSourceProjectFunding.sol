// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract OpenSourceProjectFunding is ReentrancyGuard {
    // Structure to represent a project
    struct Project {
        uint256 projectNumber;          // Unique identifier for the project
        address payable owner;          // Address of the project creator
        string name;                    // Name of the project
        string description;             // Description of the project
        string url;                     // URL pointing to the project or its details
        uint256 fundingGoal;            // Target amount to be raised
        uint256 totalFunds;             // Total funds raised so far
        bool isCompleted;               // Status indicating if the project reached its goal
        uint256 deadline;               // Timestamp after which project expires
        bool isExpired;                 // Status indicating if the deadline has passed
        bool isWithdrawn;               // Indicates if funds were withdrawn early
    }

    uint256 projectCount;                     // Total number of projects created
    address payable public contractOwner;     // Owner of the contract
    uint256 public creationFee;               // Fee to create a project
    uint256 public contributionFee;           // Fee deducted from each contribution
    uint256 public earlyWithdrawalFee;        // Fee required for early withdrawal

    mapping(uint256 => Project) public projects; // Mapping of project ID to Project struct
    mapping(uint256 => mapping(address => uint256)) public contributions; // Contributions per project per address

    // Constructor to initialize fees and set contract owner
    constructor(uint256 _creationFee, uint256 _contributionFee, uint256 _earlyWithdrawalFee) {
        require(_creationFee > 0, "Creation fee must be greater than zero");
        require(_contributionFee > 0, "Contribution fee must be greater than zero");
        require(_earlyWithdrawalFee > 0, "Early withdrawal fee must be greater than zero");

        contractOwner = payable(msg.sender);
        creationFee = _creationFee;
        contributionFee = _contributionFee;
        earlyWithdrawalFee = _earlyWithdrawalFee;
    }

    // Modifier to restrict function to only the contract owner
    modifier onlyOwner() {
        require(msg.sender == contractOwner, "Only the contract owner can call this");
        _;
    }

    // Admin function to set creation fee
    function setCreationFee(uint256 _creationFee) public onlyOwner {
        creationFee = _creationFee;
    }

    // Admin function to set contribution fee
    function setContributionFee(uint256 _contributionFee) public onlyOwner {
        contributionFee = _contributionFee;
    }

    // Admin function to set early withdrawal fee
    function setEarlyWithdrawalFee(uint256 _earlyWithdrawalFee) public onlyOwner {
        earlyWithdrawalFee = _earlyWithdrawalFee;
    }

    // Event declarations
    event ProjectCreated(uint256 indexed projectId, address indexed owner, string name, uint256 fundingGoal, string url);
    event ProjectContributed(uint256 indexed projectId, address indexed contributor, uint256 amount);
    event ProjectWithdrawn(uint256 indexed projectId);
    event ProjectExpired(uint256 indexed projectId);
    event ProjectCompleted(uint256 indexed projectId);

    // Function to create a new project
    function createProject(string memory _name, string memory _description, string memory _url, uint256 _fundingGoal, uint256 _deadline) public payable {
        require(_fundingGoal > 0, "Funding goal must be greater than zero");
        require(_deadline > 0, "Deadline must be greater than zero");
        require(msg.value == creationFee, "Insufficient fee to create project");
        require(bytes(_name).length > 0, "Project name cannot be empty");
        require(bytes(_description).length > 0, "Project description cannot be empty");
        require(bytes(_url).length > 0, "Project URL cannot be empty");

        // Transfer creation fee to the contract owner
        contractOwner.transfer(msg.value);

        // Create and store the new project
        projects[projectCount] = Project({
            projectNumber: projectCount,
            owner: payable(msg.sender),
            name: _name,
            description: _description,
            url: _url,
            fundingGoal: _fundingGoal,
            totalFunds: 0,
            isCompleted: false,
            deadline: block.timestamp + _deadline,
            isExpired: false,
            isWithdrawn: false
        });

        emit ProjectCreated(projectCount, msg.sender, _name, _fundingGoal, _url);
        projectCount++;

        // Update the status of any expired projects
        updateProjectStatus();
    }

    // Function to return the number of created projects
    function getProjectCount() public view returns (uint256) {
        return projectCount;
    }

    // Function to update the status of projects that have passed their deadlines
    function updateProjectStatus() public {
        for (uint256 i = 0; i < projectCount; i++) {
            if (!projects[i].isExpired && block.timestamp >= projects[i].deadline && !projects[i].isCompleted && !projects[i].isWithdrawn) {
                projects[i].isExpired = true;
                emit ProjectExpired(i);
            }
        }
    }

    // Function to contribute funds to a project
    function contribute(uint256 _projectId) public payable nonReentrant {
        require(_projectId < projectCount, "Invalid project ID");

        updateProjectStatus(); // Ensure status is up to date
        Project storage project = projects[_projectId];

        require(msg.sender != project.owner, "You can't contribute to your own projects");
        require(!project.isExpired, "Project has expired");
        require(!project.isCompleted, "Project has already been completed");
        require(!project.isWithdrawn, "Project has already been withdrawn");
        require(msg.value > 0, "Contribution must be greater than zero");

        // Calculate fee and ensure amount is valid
        uint256 feeAmount = (msg.value * contributionFee) / 100;
        require(msg.value > feeAmount, "Contribution amount must be greater than fee");

        // Transfer fees and funds
        contractOwner.transfer(feeAmount);
        project.owner.transfer(msg.value - feeAmount);

        // Update project and contribution records
        project.totalFunds += msg.value - feeAmount;
        contributions[_projectId][msg.sender] += msg.value - feeAmount;

        // Check if funding goal is reached
        if (project.totalFunds >= project.fundingGoal) {
            project.isCompleted = true;
            emit ProjectCompleted(_projectId);
        }

        emit ProjectContributed(_projectId, msg.sender, msg.value - feeAmount);
    }

    // Function to view the early withdrawal fee for a project
    function getEarlyWithdrawalFee(uint256 _projectId) public view returns (uint256) {
        require(_projectId < projectCount, "Invalid project ID");
        Project storage project = projects[_projectId];

        require(msg.sender == project.owner, "Only the project owner can check early withdrawal fee");
        require(!project.isExpired, "Project has expired");
        require(!project.isCompleted, "Project has already been completed");
        require(!project.isWithdrawn, "Project has already been withdrawn");

        // If no funds have been contributed, the fee is just the creation fee
        if (project.totalFunds == 0) {
            return creationFee;
        }

        // Otherwise, calculate a percentage-based fee
        return (project.totalFunds * earlyWithdrawalFee) / 100;
    }

    // Function to withdraw early from the project
    function withdrawEarly(uint256 _projectId) public payable nonReentrant {
        require(_projectId < projectCount, "Invalid project ID");

        updateProjectStatus(); // Ensure up-to-date status

        Project storage project = projects[_projectId];

        require(msg.sender == project.owner, "Only the project owner can withdraw early");
        require(!project.isExpired, "Project has expired");
        require(!project.isCompleted, "Project has already been completed");
        require(!project.isWithdrawn, "Project has already been withdrawn");

        uint256 feeAmount = getEarlyWithdrawalFee(_projectId);
        require(msg.value == feeAmount, "Insufficient fee to withdraw early");

        contractOwner.transfer(feeAmount);
        project.isWithdrawn = true;

        emit ProjectWithdrawn(_projectId);
    }
}