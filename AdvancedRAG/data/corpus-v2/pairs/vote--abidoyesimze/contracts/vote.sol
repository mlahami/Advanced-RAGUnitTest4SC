// SPDX-License-Identifier: MIT
pragma solidity ^0.8.14;

contract VotingContract {
    event ContRegistered(
        address indexed contender,
        string indexed code,
        uint256 indexed timestamp
    );

    event VoteSuccess(
        address indexed voter, 
        address indexed contender, 
        string indexed code,
        uint256 timestamp
    );

    event VotingStarted(uint256 startTime, uint256 endTime);
    event VotingEnded(uint256 endTime);
    event WinnerDeclared(address indexed winner, string indexed code, uint32 voteCount);

    address public owner;
    bool public votingActive;
    uint256 public votingStartTime;
    uint256 public votingEndTime;
    
    uint256 public constant MAX_CONTENDERS = 3;
    uint256 public contenderCount;

    struct ContDetails {
        address contender;
        string code;
        uint32 votersNo;
        bool registered;
    }  

    mapping (address => bool) public voted;
    mapping (string => address) public codetoadd;
    mapping (address => address) public voter2cont;
    mapping (address => ContDetails) public contenderdet;
    mapping (address => bool) public isRegistered;
    address[] public contendersList;

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    modifier onlyWhenActive() {
        require(votingActive, "Voting is not active");
        require(block.timestamp >= votingStartTime, "Voting has not started yet");
        require(block.timestamp <= votingEndTime, "Voting has ended");
        _;
    }

    modifier onlyWhenInactive() {
        require(!votingActive, "Voting is currently active");
        _;
    }

    constructor() {
        owner = msg.sender;
        votingActive = false;
        contenderCount = 0;
    }

    /**
     * @notice Register a single contender
     * @param cont The address of the contender
     * @param code The unique code for the contender
     */
    function registration(address cont, string memory code) public onlyOwner onlyWhenInactive {
        require(cont != address(0), "Contender address cannot be zero");
        require(bytes(code).length > 0, "Code cannot be empty");
        require(codetoadd[code] == address(0), "Code already exists");
        require(!isRegistered[cont], "Contender already registered");
        require(contenderCount < MAX_CONTENDERS, "Maximum contenders reached");

        codetoadd[code] = cont;
        isRegistered[cont] = true;
        contendersList.push(cont);
        
        ContDetails storage c = contenderdet[cont];
        c.contender = cont;
        c.code = code;
        c.votersNo = 0;
        c.registered = true;

        contenderCount++;

        emit ContRegistered(cont, code, block.timestamp);
    }

    /**
     * @notice Register all 3 contenders at once
     * @param conts Array of 3 contender addresses
     * @param codes Array of 3 unique codes for contenders
     */
    function batchRegistration(
        address[3] memory conts,
        string[3] memory codes
    ) public onlyOwner onlyWhenInactive {
        require(contenderCount == 0, "Contenders already registered");
        
        for (uint256 i = 0; i < MAX_CONTENDERS; i++) {
            require(conts[i] != address(0), "Contender address cannot be zero");
            require(bytes(codes[i]).length > 0, "Code cannot be empty");
            require(codetoadd[codes[i]] == address(0), "Code already exists");
            require(!isRegistered[conts[i]], "Contender already registered");

            codetoadd[codes[i]] = conts[i];
            isRegistered[conts[i]] = true;
            contendersList.push(conts[i]);

            ContDetails storage c = contenderdet[conts[i]];
            c.contender = conts[i];
            c.code = codes[i];
            c.votersNo = 0;
            c.registered = true;

            contenderCount++;

            emit ContRegistered(conts[i], codes[i], block.timestamp);
        }
    }

    /**
     * @notice Start the voting process with a time frame
     * @param durationInSeconds Duration of voting period in seconds
     */
    function startVoting(uint256 durationInSeconds) public onlyOwner onlyWhenInactive {
        require(contenderCount >= 2, "Need at least 2 contenders to start voting");
        require(durationInSeconds > 0, "Duration must be greater than zero");

        votingStartTime = block.timestamp;
        votingEndTime = block.timestamp + durationInSeconds;
        votingActive = true;

        emit VotingStarted(votingStartTime, votingEndTime);
    }

    /**
     * @notice Vote for a contender by their code
     * @param code The code of the contender to vote for
     */
    function vote(string memory code) public onlyWhenActive {
        require(!voted[msg.sender], "User already voted");
        
        address contender = codetoadd[code];
        require(contender != address(0), "Invalid contender code");
        require(isRegistered[contender], "Contender not registered");

        voted[msg.sender] = true;
        voter2cont[msg.sender] = contender;
        
        ContDetails storage m = contenderdet[contender];
        m.votersNo += 1;

        emit VoteSuccess(msg.sender, contender, code, block.timestamp);

        // Auto-end voting if time has passed
        if (block.timestamp >= votingEndTime) {
            endVoting();
        }
    }

    /**
     * @notice Manually end the voting process
     */
    function endVoting() public {
        require(
            msg.sender == owner || block.timestamp >= votingEndTime,
            "Only owner can end voting before deadline"
        );
        require(votingActive, "Voting is not active");

        votingActive = false;

        emit VotingEnded(block.timestamp);
    }

    /**
     * @notice Get contender details by code
     * @param code The code of the contender
     * @return ContDetails struct with contender information
     */
    function getContender(string memory code) public view returns(ContDetails memory) {
        address c = codetoadd[code];
        require(c != address(0), "Contender not found");
        return contenderdet[c];
    }

    /**
     * @notice Get all registered contenders
     * @return Array of contender addresses
     */
    function getAllContenders() public view returns(address[] memory) {
        return contendersList;
    }

    /**
     * @notice Get winner of the election
     * @return winner Address of the winner
     * @return code Code of the winner
     * @return voteCount Number of votes received
     */
    function getWinner() public view returns(
        address winner,
        string memory code,
        uint32 voteCount
    ) {
        require(!votingActive, "Voting is still active");
        require(contenderCount > 0, "No contenders registered");

        address currentWinner = contendersList[0];
        ContDetails memory firstDetails = contenderdet[currentWinner];
        uint32 maxVotes = firstDetails.votersNo;

        for (uint256 i = 1; i < contendersList.length; i++) {
            address contender = contendersList[i];
            ContDetails memory details = contenderdet[contender];
            
            if (details.votersNo > maxVotes) {
                maxVotes = details.votersNo;
                currentWinner = contender;
            }
        }
        
        ContDetails memory winnerDetails = contenderdet[currentWinner];
        return (currentWinner, winnerDetails.code, maxVotes);
    }

    /**
     * @notice Declare and emit winner event
     */
    function declareWinner() public {
        require(!votingActive, "Voting must be ended first");
        
        (address winner, string memory code, uint32 voteCount) = getWinner();
        
        emit WinnerDeclared(winner, code, voteCount);
    }

    /**
     * @notice Get total number of votes cast
     * @return total Total votes across all contenders
     */
    function getTotalVotes() public view returns(uint32 total) {
        for (uint256 i = 0; i < contendersList.length; i++) {
            total += contenderdet[contendersList[i]].votersNo;
        }
    }

    /**
     * @notice Check if an address has voted
     * @param voter Address to check
     * @return bool True if address has voted
     */
    function hasVoted(address voter) public view returns(bool) {
        return voted[voter];
    }

    /**
     * @notice Get voting status
     * @return active Whether voting is active
     * @return startTime Start time of voting
     * @return endTime End time of voting
     */
    function getVotingStatus() public view returns(
        bool active,
        uint256 startTime,
        uint256 endTime
    ) {
        return (votingActive, votingStartTime, votingEndTime);
    }
}