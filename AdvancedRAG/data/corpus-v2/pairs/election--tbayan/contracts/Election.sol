// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VoteOption, VoteResult} from "./ElectionStructs.sol";

/// @title Election - a single election instance.
/// Ballots are Paillier ciphertexts (decimal strings) encrypted client-side
/// under the election public key (pubkeyN, pubkeyG). After the election ends,
/// the creator publishes the per-option results, and then the
/// negligible-knowledge verification data: the homomorphic ciphertext total C,
/// the decrypted encoded total M, and the combined random factor
/// w = prod(r_v) mod N. Anyone can then check off-chain that
/// C == Enc(M, w) and that C equals the product of all stored ballots mod N^2.
contract Election {
    error ElectionClosed();
    error ElectionInProgress();
    error NotAuthorized();
    error ResultsAlreadyPublished();
    error ResultsNotPublished();
    error VerificationAlreadyPublished();
    error VoteCountMismatch();
    error TooManyOptions();

    event VoteCast(address indexed voter, string vote, uint256 timestamp);
    event ResultsPublished(uint256 timestamp);
    event VerificationPublished(uint256 timestamp);

    uint256 public constant MAX_OPTIONS = 10;

    string public title;
    address public immutable creator;
    uint256 public immutable endtime;
    bool public resultsPublished;
    bool public verificationPublished;

    // Election Paillier public key.
    string public pubkeyN;
    string public pubkeyG;

    // Negligible-knowledge verification data (published after tallying).
    string public encryptedTotal; // C = prod(ballots) mod N^2
    string public encodedTotal; // M = Dec(C), the encoded tally
    string public randomFactorW; // w with C == Enc(M, w)

    // votes[0] is a placeholder so that voteMap value 0 means "not voted yet".
    string[] public votes;
    mapping(address => uint256) private voteMap;
    VoteOption[] public options;
    VoteResult[] public results;

    constructor(
        VoteOption[] memory _options,
        uint256 _endtime,
        string memory _title,
        string memory _pubkeyN,
        string memory _pubkeyG,
        address _creator
    ) {
        if (_options.length > MAX_OPTIONS) revert TooManyOptions();
        for (uint256 i = 0; i < _options.length; i++) {
            options.push(_options[i]);
            results.push(VoteResult(_options[i], 0));
        }
        votes.push("");
        endtime = _endtime;
        title = _title;
        pubkeyN = _pubkeyN;
        pubkeyG = _pubkeyG;
        creator = _creator;
    }

    /// Cast (or replace) an encrypted ballot. Only the latest ballot per
    /// address is kept, which provides coercion resistance via re-voting.
    function recordVote(string memory _vote) public {
        if (block.timestamp >= endtime || resultsPublished || verificationPublished) {
            revert ElectionClosed();
        }
        uint256 index = voteMap[msg.sender];
        if (index == 0) {
            votes.push(_vote);
            voteMap[msg.sender] = votes.length - 1;
        } else {
            votes[index] = _vote;
        }
        emit VoteCast(msg.sender, _vote, block.timestamp);
    }

    function publishResults(VoteResult[] memory submittedResults) public {
        if (msg.sender != creator) revert NotAuthorized();
        if (block.timestamp <= endtime) revert ElectionInProgress();
        if (resultsPublished) revert ResultsAlreadyPublished();
        uint256 totalVoteCount = 0;
        for (uint256 i = 0; i < submittedResults.length; i++) {
            totalVoteCount += submittedResults[i].count;
        }
        if (totalVoteCount != votes.length - 1) revert VoteCountMismatch();
        for (uint256 i = 0; i < submittedResults.length; i++) {
            results[i].count = submittedResults[i].count;
        }
        resultsPublished = true;
        emit ResultsPublished(block.timestamp);
    }

    /// Publish the negligible-knowledge verification data. Must happen after
    /// the results so the published tally cannot be adjusted afterwards.
    function publishVerification(
        string memory _encryptedTotal,
        string memory _encodedTotal,
        string memory _randomFactorW
    ) public {
        if (msg.sender != creator) revert NotAuthorized();
        if (block.timestamp <= endtime) revert ElectionInProgress();
        if (!resultsPublished) revert ResultsNotPublished();
        if (verificationPublished) revert VerificationAlreadyPublished();
        encryptedTotal = _encryptedTotal;
        encodedTotal = _encodedTotal;
        randomFactorW = _randomFactorW;
        verificationPublished = true;
        emit VerificationPublished(block.timestamp);
    }

    function getVerification()
        public
        view
        returns (string memory, string memory, string memory)
    {
        return (encryptedTotal, encodedTotal, randomFactorW);
    }

    function getOptions() public view returns (VoteOption[] memory) {
        return options;
    }

    function getResults() public view returns (VoteResult[] memory) {
        return results;
    }

    function getVotes() public view returns (string[] memory) {
        return votes;
    }

    function voteCount() public view returns (uint256) {
        return votes.length - 1;
    }
}
