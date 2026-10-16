// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title A DAO bringing animal lovers efforts together to enhance wildlife protection
/// @author Myriam Chah

contract Fauna is Ownable, ReentrancyGuard {

// *********************************** STRUCTS ***********************************  
    
  struct Donator {
    uint totalDonated;
    bool hasVoted;
    uint votedProjectId;
  }

  struct Project {
    string name;
    string desc;
    address projAddress;
    uint voteCount;
    uint fundsReceived;
    bool usageCertified; 
  }

  enum  Phase {
    ProjectsCuration,
    VotesStarted,
    VotesEnded,
    FundsSent
  }

// *********************************** VARIABLES ***********************************  

  Phase public phase;
  Project[] projects;
  mapping (address => Donator) donators;
  uint public totalVotes;

// *********************************** EVENTS ***********************************  
   
  /// @notice Emitted when entering a new phase 
  /// @param current The current phase 
  event NewPhase(Phase current);

  /// @notice Emitted when a donation is received
  /// @param donator Adress of the donator
  /// @param amount Amount of the donation
  event DonationReceived(address donator, uint amount); 

  /// @notice Emitted when a project has been added by owner
  /// @param projectId Id of the added project
  event ProjectCurated(uint projectId);

  /// @notice Emitted when a donator has voted
  /// @param donator Adress of the donator who voted
  /// @param votedProjectId Id of the project he/she voted for
  event Voted (address donator, uint votedProjectId);

  /// @notice Emitted when funds are sent to an elected project 
  /// @param amount Adress of the donator who voted
  /// @param projectId Id of the project he/she voted for
  event FundsGranted(uint amount, uint projectId);

  /// @notice Emitted when the owner attested of the  propoer usage of funds by a project
  /// @param projectId Id of the project
  /// @param comment Comment written by owner expliciting how funds have been used
  event ProperFundsUsageCertified(uint projectId, string comment);

// *********************************** CONSTRUCTOR ***********************************  

  /// @notice Starts the Ownable pattern
  constructor() Ownable(msg.sender) {    }

// *********************************** MODIFIER ***********************************  

  /// @notice Checks if the message sender is a Donator
  modifier onlyDonators() {
    require(donators[msg.sender].totalDonated > 0, "Not donator");
    _;
  }

 // *********************************** GETTERS ***********************************  

  /** 
  * @notice Get a donator based on an address.
  * @param _addr The address to look for
  * @return donator  The donator corresponding to the given address
  */
  function getDonator(address _addr) external view returns (Donator memory donator) {
    donator = donators[_addr];
  }

  /** 
  * @notice Get a project based on an id.
  * @param _id The id to look for
  * @return project  The project corresponding to the given id
  */
  function getProject(uint _id) external view returns (Project memory project) {
    project =  projects[_id];
  }

  /** 
  * @notice Get all projects.
  * @return projects An array of all the projects
  */
  function getProjects() external view returns(Project[] memory) {
    return projects;
  }

  /** 
  * @notice Get contract's balance.
  * @return uint The contract's balance
  */
  function getContractBalance() external view returns(uint) {
    return address(this).balance;
  }


//  *********************************** FUNDS ************************************  


  /** 
  * @notice Make a donation in ETH
  * Will trigger an error if msg.value is 0.
  */
  function donate() external payable {
    require(msg.value > 0, "Not enough funds deposited");
    donators[msg.sender].totalDonated += msg.value;
    emit DonationReceived(msg.sender, msg.value); 
  }

  /** 
  * @notice Split and send funds to elected projects, proportionnally to their vote count. 
  * Only the owner can call this method. 
  * Will trigger an error if Voting phase is not ended or if contract's balance is 0.
  * @dev A manual guard prevents from reentrancy attack.
  */
  function sendFunds() external onlyOwner nonReentrant {
    require(phase >= Phase.VotesEnded, "Votes not ended");
    require(address(this).balance > 0, "Empty balance");
    uint balance = address(this).balance;

    for(uint i;i < projects.length;i++){
      if (projects[i].voteCount > 0) {
        uint amount = (balance * projects[i].voteCount) / totalVotes;
        projects[i].fundsReceived = amount;
        (bool received, ) = projects[i].projAddress.call{value: amount}("");
        require(received, "Payment failed");
        emit FundsGranted(amount, i);
      }
    }
    phase = Phase.FundsSent;
    emit NewPhase(phase);  
  }

  /** 
  * @notice Attest how funds have been used.
  * Only the owner can call this method. 
  * Will trigger an error if Project did not receive funds.
  * @param _id Id of the project.
  * @param _comment Description of how the funds have been used.
  */
  function certifyFundsUsage(uint _id, string calldata _comment) external onlyOwner {
    require(projects[_id].fundsReceived > 0, "No funds received");
    projects[_id].usageCertified = true;
    emit ProperFundsUsageCertified(_id, _comment);
  }

// *********************************** PROJECTS ***********************************  


  /** 
  * @notice Add a project.
  * Only the owner can call this method. 
  * Will trigger an error if any arg is missing or if project curation phase is over.
  * @param _name Name of the project.
  * @param _desc Description of how project's need.
  * @param _projAddress Address where to send the funds if project is elected.
  */
  function addCuratedProject(string calldata _name, string calldata _desc, address _projAddress) external onlyOwner {
    require(phase == Phase.ProjectsCuration, "Project curation is over");
    require(bytes(_name).length > 0, "No name");
    require(bytes(_desc).length > 0, "No description");
    require(_projAddress != address(0), "No address");

    projects.push(Project(_name, _desc, _projAddress, 0, 0, false));
    emit ProjectCurated(projects.length -1);
  }


// *********************************** VOTES ***********************************  

  /** 
  * @notice Start voting phase.
  * Only the owner can call this method. 
  * Will trigger an error if no projects have been added yet or if project curation phase is over.
  */
  function startVotes() external onlyOwner {
    require(phase == Phase.ProjectsCuration, "Cannot start votes now");
    require(0 < projects.length, "No projects to vote for");
    phase = Phase.VotesStarted;
    emit NewPhase(phase);
  }

  /** 
  * @notice Vote for a project.
  * Only a donator can call this method. 
  * Will trigger an error if not the right phase, if donator already voted or if given project id is unknown.
  * @param _id Id of the project to vote for.
  */
  function submitVote(uint _id) external onlyDonators {
    require(phase == Phase.VotesStarted, "Cannot vote now");
    require(donators[msg.sender].hasVoted != true, "You already voted");
    require(_id < projects.length, "Unknown project"); 

    donators[msg.sender].votedProjectId = _id;
    donators[msg.sender].hasVoted = true;
    projects[_id].voteCount++;
    totalVotes++;

    emit Voted(msg.sender, _id);
  }

  /** 
  * @notice End voting phase.
  * Only the owner can call this method. 
  * Will trigger an error if votes did not start or if nobody voted yet.
  */
  function endVotes() external onlyOwner {
    require(phase == Phase.VotesStarted, "Cannot end votes now");
    require(totalVotes > 0, "No votes submitted yet");
    phase = Phase.VotesEnded;
    emit NewPhase(phase);
  }
}