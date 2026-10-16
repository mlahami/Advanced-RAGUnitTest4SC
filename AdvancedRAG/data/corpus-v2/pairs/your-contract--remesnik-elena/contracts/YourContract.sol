//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "hardhat/console.sol";

/**
 * @title EscrowContract
 * @dev Смарт-контракт эскроу для безопасных P2P транзакций
 * @author BuidlGuidl
 */
contract YourContract {
    // Перечисление статусов сделки
    enum EscrowStatus {
        CREATED,        // Создана
        FUNDED,         // Профинансирована
        DELIVERED,      // Доставлено
        COMPLETED,      // Завершена
        DISPUTED,       // Оспаривается
        REFUNDED,       // Возвращена
        CANCELLED       // Отменена
    }

    // Структура сделки эскроу
    struct Escrow {
        uint256 id;
        address payable buyer;
        address payable seller;
        address payable arbiter;
        uint256 amount;
        uint256 arbiterFee;
        EscrowStatus status;
        string description;
        uint256 createdAt;
        uint256 completedAt;
        bool buyerApproved;
        bool sellerApproved;
    }

    // Переменные состояния
    address public immutable owner;
    uint256 public escrowCounter;
    uint256 public totalVolume;
    uint256 public platformFeePercent = 1; // 1% комиссия платформы
    
    mapping(uint256 => Escrow) public escrows;
    mapping(address => uint256[]) public userEscrows;
    mapping(address => uint256) public pendingWithdrawals;

    // События
    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed buyer,
        address indexed seller,
        address arbiter,
        uint256 amount,
        string description
    );
    
    event EscrowFunded(uint256 indexed escrowId, address indexed buyer, uint256 amount);
    event EscrowDelivered(uint256 indexed escrowId, address indexed seller);
    event EscrowCompleted(uint256 indexed escrowId, uint256 timestamp);
    event EscrowDisputed(uint256 indexed escrowId, address indexed disputedBy);
    event DisputeResolved(uint256 indexed escrowId, address indexed winner, uint256 amount);
    event EscrowRefunded(uint256 indexed escrowId, uint256 amount);
    event EscrowCancelled(uint256 indexed escrowId);
    event WithdrawalProcessed(address indexed user, uint256 amount);

    // Модификаторы
    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    modifier escrowExists(uint256 _escrowId) {
        require(_escrowId < escrowCounter, "Escrow does not exist");
        _;
    }

    modifier onlyBuyer(uint256 _escrowId) {
        require(msg.sender == escrows[_escrowId].buyer, "Only buyer can call this");
        _;
    }

    modifier onlySeller(uint256 _escrowId) {
        require(msg.sender == escrows[_escrowId].seller, "Only seller can call this");
        _;
    }

    modifier onlyArbiter(uint256 _escrowId) {
        require(msg.sender == escrows[_escrowId].arbiter, "Only arbiter can call this");
        _;
    }

    modifier inStatus(uint256 _escrowId, EscrowStatus _status) {
        require(escrows[_escrowId].status == _status, "Invalid escrow status");
        _;
    }

    constructor(address _owner) {
        owner = _owner;
        console.log("Escrow Contract deployed by:", _owner);
    }

    /**
     * @dev Создание новой сделки эскроу
     * @param _seller Адрес продавца
     * @param _arbiter Адрес арбитра
     * @param _arbiterFee Комиссия арбитра
     * @param _description Описание сделки
     */
    function createEscrow(
        address payable _seller,
        address payable _arbiter,
        uint256 _arbiterFee,
        string memory _description
    ) public payable returns (uint256) {
        require(msg.value > 0, "Amount must be greater than 0");
        require(_seller != address(0), "Invalid seller address");
        require(_arbiter != address(0), "Invalid arbiter address");
        require(_seller != msg.sender, "Buyer and seller cannot be the same");
        require(_arbiterFee <= msg.value / 10, "Arbiter fee too high (max 10%)");

        uint256 escrowId = escrowCounter;
        
        escrows[escrowId] = Escrow({
            id: escrowId,
            buyer: payable(msg.sender),
            seller: _seller,
            arbiter: _arbiter,
            amount: msg.value,
            arbiterFee: _arbiterFee,
            status: EscrowStatus.FUNDED,
            description: _description,
            createdAt: block.timestamp,
            completedAt: 0,
            buyerApproved: false,
            sellerApproved: false
        });

        userEscrows[msg.sender].push(escrowId);
        userEscrows[_seller].push(escrowId);
        
        escrowCounter++;
        totalVolume += msg.value;

        emit EscrowCreated(escrowId, msg.sender, _seller, _arbiter, msg.value, _description);
        emit EscrowFunded(escrowId, msg.sender, msg.value);

        console.log("Escrow created with ID:", escrowId);
        
        return escrowId;
    }

    /**
     * @dev Продавец подтверждает отправку товара/услуги
     * @param _escrowId ID сделки
     */
    function confirmDelivery(uint256 _escrowId) 
        public 
        escrowExists(_escrowId)
        onlySeller(_escrowId)
        inStatus(_escrowId, EscrowStatus.FUNDED)
    {
        escrows[_escrowId].status = EscrowStatus.DELIVERED;
        escrows[_escrowId].sellerApproved = true;
        
        emit EscrowDelivered(_escrowId, msg.sender);
        console.log("Delivery confirmed for escrow:", _escrowId);
    }

    /**
     * @dev Покупатель подтверждает получение и освобождает средства
     * @param _escrowId ID сделки
     */
    function confirmReceipt(uint256 _escrowId)
        public
        escrowExists(_escrowId)
        onlyBuyer(_escrowId)
        inStatus(_escrowId, EscrowStatus.DELIVERED)
    {
        Escrow storage escrow = escrows[_escrowId];
        escrow.status = EscrowStatus.COMPLETED;
        escrow.completedAt = block.timestamp;
        escrow.buyerApproved = true;

        uint256 platformFee = (escrow.amount * platformFeePercent) / 100;
        uint256 sellerAmount = escrow.amount - platformFee;

        pendingWithdrawals[escrow.seller] += sellerAmount;
        pendingWithdrawals[owner] += platformFee;

        emit EscrowCompleted(_escrowId, block.timestamp);
        console.log("Receipt confirmed for escrow:", _escrowId);
    }

    /**
     * @dev Инициировать спор
     * @param _escrowId ID сделки
     */
    function raiseDispute(uint256 _escrowId)
        public
        escrowExists(_escrowId)
    {
        Escrow storage escrow = escrows[_escrowId];
        require(
            msg.sender == escrow.buyer || msg.sender == escrow.seller,
            "Only buyer or seller can raise dispute"
        );
        require(
            escrow.status == EscrowStatus.FUNDED || escrow.status == EscrowStatus.DELIVERED,
            "Invalid status for dispute"
        );

        escrow.status = EscrowStatus.DISPUTED;
        
        emit EscrowDisputed(_escrowId, msg.sender);
        console.log("Dispute raised for escrow:", _escrowId);
    }

    /**
     * @dev Арбитр разрешает спор
     * @param _escrowId ID сделки
     * @param _favorBuyer true если в пользу покупателя, false если в пользу продавца
     */
    function resolveDispute(uint256 _escrowId, bool _favorBuyer)
        public
        escrowExists(_escrowId)
        onlyArbiter(_escrowId)
        inStatus(_escrowId, EscrowStatus.DISPUTED)
    {
        Escrow storage escrow = escrows[_escrowId];
        
        uint256 amountAfterArbiterFee = escrow.amount - escrow.arbiterFee;
        
        if (_favorBuyer) {
            escrow.status = EscrowStatus.REFUNDED;
            pendingWithdrawals[escrow.buyer] += amountAfterArbiterFee;
            emit DisputeResolved(_escrowId, escrow.buyer, amountAfterArbiterFee);
        } else {
            escrow.status = EscrowStatus.COMPLETED;
            uint256 platformFee = (amountAfterArbiterFee * platformFeePercent) / 100;
            uint256 sellerAmount = amountAfterArbiterFee - platformFee;
            
            pendingWithdrawals[escrow.seller] += sellerAmount;
            pendingWithdrawals[owner] += platformFee;
            emit DisputeResolved(_escrowId, escrow.seller, sellerAmount);
        }
        
        pendingWithdrawals[escrow.arbiter] += escrow.arbiterFee;
        escrow.completedAt = block.timestamp;
        
        console.log("Dispute resolved for escrow:", _escrowId);
    }

    /**
     * @dev Отмена сделки (только до финансирования или по согласию обеих сторон)
     * @param _escrowId ID сделки
     */
    function cancelEscrow(uint256 _escrowId)
        public
        escrowExists(_escrowId)
    {
        Escrow storage escrow = escrows[_escrowId];
        require(
            msg.sender == escrow.buyer || msg.sender == escrow.seller,
            "Only buyer or seller can cancel"
        );
        require(
            escrow.status == EscrowStatus.FUNDED,
            "Can only cancel funded escrows"
        );

        escrow.status = EscrowStatus.CANCELLED;
        pendingWithdrawals[escrow.buyer] += escrow.amount;

        emit EscrowCancelled(_escrowId);
        emit EscrowRefunded(_escrowId, escrow.amount);
        console.log("Escrow cancelled:", _escrowId);
    }

    /**
     * @dev Вывод средств пользователем
     */
    function withdraw() public {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No funds to withdraw");

        pendingWithdrawals[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Withdrawal failed");

        emit WithdrawalProcessed(msg.sender, amount);
        console.log("Withdrawal processed:", amount);
    }

    /**
     * @dev Получить детали сделки
     * @param _escrowId ID сделки
     */
    function getEscrow(uint256 _escrowId)
        public
        view
        escrowExists(_escrowId)
        returns (Escrow memory)
    {
        return escrows[_escrowId];
    }

    /**
     * @dev Получить все сделки пользователя
     * @param _user Адрес пользователя
     */
    function getUserEscrows(address _user) public view returns (uint256[] memory) {
        return userEscrows[_user];
    }

    /**
     * @dev Получить баланс для вывода
     * @param _user Адрес пользователя
     */
    function getPendingWithdrawal(address _user) public view returns (uint256) {
        return pendingWithdrawals[_user];
    }

    /**
     * @dev Обновить комиссию платформы (только владелец)
     * @param _newFeePercent Новая комиссия в процентах
     */
    function updatePlatformFee(uint256 _newFeePercent) public onlyOwner {
        require(_newFeePercent <= 5, "Fee too high (max 5%)");
        platformFeePercent = _newFeePercent;
    }

    /**
     * @dev Получить статистику платформы
     */
    function getPlatformStats() public view returns (
        uint256 totalEscrows,
        uint256 totalVolumeProcessed,
        uint256 currentFeePercent
    ) {
        return (escrowCounter, totalVolume, platformFeePercent);
    }

    /**
     * @dev Функция для получения ETH контрактом
     */
    receive() external payable {
        console.log("Received ETH:", msg.value);
    }
}
