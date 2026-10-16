// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Lottery
 * @dev 链上即时抽签系统合约
 * @author 高级程序员
 */
contract Lottery {
    /**
     * @dev 抽签活动信息结构体
     * @param endTime 抽签结束时间戳
     * @param participants 参与者地址数组
     * @param isActive 抽签是否活跃
     * @param winner 中奖者地址
     * @param creator 创建者地址
     */
    struct LotteryInfo {
        uint256 endTime;
        address[] participants;
        bool isActive;
        address winner;
        address creator;
    }

    // 抽签ID到抽签信息的映射
    mapping(uint256 => LotteryInfo) public lotteries;

    // 下一个抽签ID
    uint256 public nextLotteryId;

    // 每个抽签ID的参与者数量
    mapping(uint256 => uint256) public participantCount;

    /**
     * @dev 抽签创建事件
     * @param lotteryId 抽签ID
     * @param endTime 结束时间
     */
    event LotteryCreated(uint256 indexed lotteryId, uint256 endTime);

    /**
     * @dev 参与抽签事件
     * @param lotteryId 抽签ID
     * @param participant 参与者地址
     */
    event LotteryJoined(uint256 indexed lotteryId, address indexed participant);

    /**
     * @dev 中奖者选出事件
     * @param lotteryId 抽签ID
     * @param winner 中奖者地址
     */
    event WinnerPicked(uint256 indexed lotteryId, address indexed winner);

    /**
     * @dev 创建新的抽签活动
     * @param durationSeconds 抽签持续时间（秒）
     */
    function createLottery(uint256 durationSeconds) external {
        require(durationSeconds > 0, "Duration must be greater than zero");
        require(durationSeconds <= 7 days, "Duration cannot exceed 7 days");

        uint256 lotteryId = nextLotteryId++;
        uint256 endTime = block.timestamp + durationSeconds;

        lotteries[lotteryId] = LotteryInfo({
            endTime: endTime,
            participants: new address[](0),
            isActive: true,
            winner: address(0),
            creator: msg.sender
        });

        emit LotteryCreated(lotteryId, endTime);
    }

    /**
     * @dev 参与抽签活动
     * @param lotteryId 抽签ID
     */
    function joinLottery(uint256 lotteryId) external {
        LotteryInfo storage lottery = lotteries[lotteryId];

        require(lottery.isActive, "Lottery is not active");
        require(block.timestamp < lottery.endTime, "Lottery has ended");
        require(lottery.winner == address(0), "Lottery has already been drawn");

        // 检查是否已经参与过
        for (uint256 i = 0; i < lottery.participants.length; i++) {
            require(lottery.participants[i] != msg.sender, "Already participated");
        }

        lottery.participants.push(msg.sender);
        participantCount[lotteryId]++;

        emit LotteryJoined(lotteryId, msg.sender);
    }

    /**
     * @dev 开奖函数
     * @param lotteryId 抽签ID
     */
    function drawWinner(uint256 lotteryId) external {
        LotteryInfo storage lottery = lotteries[lotteryId];

        require(lottery.isActive, "Lottery is not active");
        require(block.timestamp >= lottery.endTime, "Lottery is still ongoing");
        require(lottery.participants.length > 0, "No participants in the lottery");
        require(lottery.winner == address(0), "Winner already drawn");

        // 使用区块哈希和参与人数生成伪随机数
        uint256 randomIndex = uint256(
            keccak256(
                abi.encodePacked(blockhash(block.number - 1), block.timestamp, lottery.participants.length, lotteryId)
            )
        ) % lottery.participants.length;

        address winner = lottery.participants[randomIndex];
        lottery.winner = winner;
        lottery.isActive = false;

        emit WinnerPicked(lotteryId, winner);
    }

    /**
     * @dev 获取抽签参与者列表
     * @param lotteryId 抽签ID
     * @return 参与者地址数组
     */
    function getParticipants(uint256 lotteryId) external view returns (address[] memory) {
        return lotteries[lotteryId].participants;
    }

    /**
     * @dev 获取抽签详细信息
     * @param lotteryId 抽签ID
     * @return endTime 结束时间
     * @return participantCountValue 参与者数量
     * @return isActive 是否活跃
     * @return winner 中奖者
     * @return creator 创建者
     */
    function getLotteryInfo(
        uint256 lotteryId
    )
        external
        view
        returns (uint256 endTime, uint256 participantCountValue, bool isActive, address winner, address creator)
    {
        LotteryInfo memory lottery = lotteries[lotteryId];
        return (lottery.endTime, lottery.participants.length, lottery.isActive, lottery.winner, lottery.creator);
    }

    /**
     * @dev 检查地址是否已参与抽签
     * @param lotteryId 抽签ID
     * @param participant 参与者地址
     * @return 是否已参与
     */
    function hasParticipated(uint256 lotteryId, address participant) external view returns (bool) {
        LotteryInfo memory lottery = lotteries[lotteryId];
        for (uint256 i = 0; i < lottery.participants.length; i++) {
            if (lottery.participants[i] == participant) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev 获取所有抽签的基本信息
     * @return lotteryIds 抽签ID数组
     * @return endTimes 结束时间数组
     * @return participantCounts 参与者数量数组
     * @return isActiveArray 是否活跃数组
     * @return winners 中奖者数组
     */
    function getAllLotteries()
        external
        view
        returns (
            uint256[] memory lotteryIds,
            uint256[] memory endTimes,
            uint256[] memory participantCounts,
            bool[] memory isActiveArray,
            address[] memory winners
        )
    {
        uint256 total = nextLotteryId;
        lotteryIds = new uint256[](total);
        endTimes = new uint256[](total);
        participantCounts = new uint256[](total);
        isActiveArray = new bool[](total);
        winners = new address[](total);

        for (uint256 i = 0; i < total; i++) {
            LotteryInfo memory lottery = lotteries[i];
            lotteryIds[i] = i;
            endTimes[i] = lottery.endTime;
            participantCounts[i] = lottery.participants.length;
            isActiveArray[i] = lottery.isActive;
            winners[i] = lottery.winner;
        }
    }
}
