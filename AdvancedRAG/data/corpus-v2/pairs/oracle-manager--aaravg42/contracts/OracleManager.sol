// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract OracleManager {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint256 public constant ORACLE_BOND = 0.00001 ether;
    uint256 public constant MIN_ORACLES = 1;

    address public owner;
    address public bondVault;

    struct OracleInfo {
        bool registered;
        bool bonded;
        uint256 bondAmount;
    }

    struct PriceReport {
        uint256 price;
        uint256 timestamp;
        address oracle;
    }

    mapping(address => OracleInfo) public oracles;
    address[] public oracleList;
    mapping(uint32 => PriceReport[]) public epochReports;
    mapping(uint32 => mapping(address => bool)) public hasReported;

    event OracleRegistered(address indexed oracle);
    event OracleBonded(address indexed oracle, uint256 amount);
    event OracleSlashed(address indexed oracle, uint256 amount);
    event PriceReported(uint32 indexed epochId, address indexed oracle, uint256 price);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyRegisteredOracle() {
        require(oracles[msg.sender].registered, "Not registered oracle");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setBondVault(address _bondVault) external onlyOwner {
        bondVault = _bondVault;
    }

    function registerOracle(address oracle) external onlyOwner {
        require(!oracles[oracle].registered, "Already registered");
        
        oracles[oracle] = OracleInfo({
            registered: true,
            bonded: false,
            bondAmount: 0
        });
        oracleList.push(oracle);

        emit OracleRegistered(oracle);
    }

    function bondOracle(address oracle) external payable {
        require(oracles[oracle].registered, "Oracle not registered");
        require(msg.value >= ORACLE_BOND, "Insufficient bond");
        
        oracles[oracle].bonded = true;
        oracles[oracle].bondAmount += msg.value;

        emit OracleBonded(oracle, msg.value);
    }

    function submitSignedReport(
        uint32 epochId,
        uint256 price,
        bytes calldata signature
    ) external {
        bytes32 messageHash = keccak256(abi.encodePacked(epochId, price));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(signature);

        require(oracles[signer].registered, "Signer not registered oracle");
        require(oracles[signer].bonded, "Oracle not bonded");
        require(!hasReported[epochId][signer], "Already reported");

        hasReported[epochId][signer] = true;
        epochReports[epochId].push(PriceReport({
            price: price,
            timestamp: block.timestamp,
            oracle: signer
        }));

        emit PriceReported(epochId, signer, price);
    }

    function submitReport(uint32 epochId, uint256 price) external onlyRegisteredOracle {
        require(oracles[msg.sender].bonded, "Oracle not bonded");
        require(!hasReported[epochId][msg.sender], "Already reported");

        hasReported[epochId][msg.sender] = true;
        epochReports[epochId].push(PriceReport({
            price: price,
            timestamp: block.timestamp,
            oracle: msg.sender
        }));

        emit PriceReported(epochId, msg.sender, price);
    }

    function getEpochPrice(uint32 epochId) external view returns (uint256) {
        PriceReport[] storage reports = epochReports[epochId];
        uint256 count = reports.length;
        
        if (count == 0) {
            return 0;
        }

        uint256[] memory prices = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            prices[i] = reports[i].price;
        }

        for (uint256 i = 0; i < count - 1; i++) {
            for (uint256 j = 0; j < count - i - 1; j++) {
                if (prices[j] > prices[j + 1]) {
                    uint256 temp = prices[j];
                    prices[j] = prices[j + 1];
                    prices[j + 1] = temp;
                }
            }
        }

        if (count % 2 == 1) {
            return prices[count / 2];
        } else {
            return (prices[count / 2 - 1] + prices[count / 2]) / 2;
        }
    }

    function slashOracle(address oracle, uint256 amount) external {
        require(msg.sender == owner || msg.sender == bondVault, "Not authorized");
        require(oracles[oracle].bondAmount >= amount, "Insufficient bond");

        oracles[oracle].bondAmount -= amount;
        if (oracles[oracle].bondAmount == 0) {
            oracles[oracle].bonded = false;
        }

        emit OracleSlashed(oracle, amount);
    }

    function getReportCount(uint32 epochId) external view returns (uint256) {
        return epochReports[epochId].length;
    }

    function getReport(uint32 epochId, uint256 index) external view returns (
        uint256 price,
        uint256 timestamp,
        address oracle
    ) {
        PriceReport storage report = epochReports[epochId][index];
        return (report.price, report.timestamp, report.oracle);
    }

    function getOracleCount() external view returns (uint256) {
        return oracleList.length;
    }

    function isOracleBonded(address oracle) external view returns (bool) {
        return oracles[oracle].bonded;
    }
}


