// SPDX-License-Identifier: Apache-2.0 license
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract HeadSoccerRubies is ERC20, AccessControl {
    /**
     * @dev The role of the wallet, which can trigger the start and finish functions of the game.
     */
    bytes32 public constant FRONTEND_WALLET = keccak256("FRONTEND_WALLET");

    /**
     * @dev The amount of the commission for the game - default 20%.
     */
    uint256 public commissions = 20;

    /**
     * @dev The number of rubies per token.
     */
    uint256 public conversion = 10;

    /**
     * @dev Addresses of tokens for which rubies can be exchanged.
     */
    address public immutable USDT;

    /**
     * @dev The address of the contract owner.
     */
    address internal immutable owner;

    /**
     * @dev Invalid token to exchange.
     */
    error NotValidToken(address token);

    /**
     * @dev There are not enough ERC20 tokens to exchange.
     */
    error NotEnoughERC20(uint256 balanceOf, uint256 amount);

    /**
     * @dev There are not enough rubies tokens to exchange.
     */
    error NotEnoughRubies(uint256 balanceOf, uint256 amount);

    /**
     * @dev The commission is too small or too large.
     */
    error NotRightCommission(uint256 newCommission);

    /**
     * @dev Check zero address usdt.
     */
    error ZeroAddress(address zeroAddress);

    /**
     * @dev An error occurs when the function does not call the frontend wallet.
     */
    error CallerNotFrontWallet(address caller);

    event ChangeERC20toRubies(uint256 amount, address token);
    event ChangeRubiesToERC20(uint256 amount, address token);
    event ChangeRubies(uint256 amount);
    event StartGameEvent(uint256 amount, address player1, address player2);
    event FinishGameEvent(address winner, uint256 rewars);

    /**
     * @dev The modifier checks whether the balance of rubies is sufficient for the operation.
     */
    modifier hasEnoughBalance(uint256 amount) {
        if (balanceOf(msg.sender) < amount) {
            revert NotEnoughRubies(balanceOf(msg.sender), amount);
        }
        _;
    }

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial owner.
     * @param _frontWallet Wallet to start the game function and finish the game.
     */
    constructor(
        address _frontWallet,
        address _usdt
    ) ERC20("HeadSoccerRubies", "HSR") {
        owner = msg.sender;
        if (_usdt == address(0)) {
            revert ZeroAddress(_usdt);
        }
        USDT = _usdt;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(FRONTEND_WALLET, _frontWallet);
    }

    /**
     * @notice Before the exchange, it is necessary to give the specified contract permission to dispose of the token.
     * @dev The function of exchanging ERC20 tokens for rubies.
     * @param amount The number of tokens.
     */
    function changeERC20toRubie(uint256 amount) external {
        IERC20 token = IERC20(USDT);
        uint256 userBalance = token.balanceOf(msg.sender);
        uint256 normalizedAmount = amount / 1e12;
        if (userBalance < normalizedAmount) {
            revert NotEnoughERC20(userBalance, normalizedAmount);
        }
        require(
            token.transferFrom(msg.sender, address(this), normalizedAmount)
        );
        _mint(msg.sender, amount * conversion);
        emit ChangeERC20toRubies(amount, USDT);
    }

    /**
     * @dev The function of exchanging rubies for ERC20 tokens.
     * @param amount The number of tokens.
     */
    function changeRubieToERC20(
        uint256 amount
    ) external hasEnoughBalance(amount) {
        uint256 normalizedAmount = amount / 1e12;
        _burn(msg.sender, amount);
        require(
            IERC20(USDT).transfer(msg.sender, normalizedAmount / conversion)
        );
        emit ChangeRubiesToERC20(amount, USDT);
    }

    /**
     * @dev The function of sending the commission and the price of the items to the owner.
     * @param amount The number of tokens.
     */
    function sendMoneyToOwner(uint256 amount) internal {
        uint256 normalizedAmount = amount / 1e12;
        require(IERC20(USDT).transfer(owner, normalizedAmount / conversion));
    }

    /**
     * @dev The function of exchanging rubies for any other items.
     * @param amount The number of tokens.
     */
    function changeRubieToThings(
        uint256 amount
    ) public hasEnoughBalance(amount) {
        _burn(msg.sender, amount);
        sendMoneyToOwner(amount);
        emit ChangeRubies(amount);
    }

    /**
     * @dev The function should be called by the frontend (game) after two players enter the waiting room and press the play button.
     * @param amount The number of tokens.
     * @param player1 The address of the first player.
     * @param player2 The address of the second player.
     */
    function startGame(
        address player1,
        address player2,
        uint256 amount
    ) external onlyRole(FRONTEND_WALLET) {
        if (player1 == address(0)) {
            revert ZeroAddress(player1);
        }
        if (player2 == address(0)) {
            revert ZeroAddress(player2);
        }
        if (balanceOf(player1) < amount) {
            revert NotEnoughRubies(balanceOf(player1), amount);
        }
        if (balanceOf(player2) < amount) {
            revert NotEnoughRubies(balanceOf(player2), amount);
        }

        uint256 commissionForGame = (amount * commissions) / 100;

        _burn(player1, amount);
        _burn(player2, amount);

        sendMoneyToOwner(commissionForGame * 2);

        emit StartGameEvent(amount, player1, player2);
    }

    /**
     * @dev The function should be called by the frontend (game) after the end of the game and sends the rewards for the game.
     * @param winner The winner of the game.
     * @param rewars Awards to the winner.
     */
    function finishGame(
        address winner,
        uint256 rewars
    ) external onlyRole(FRONTEND_WALLET) {
        if (winner == address(0)) {
            revert ZeroAddress(winner);
        }
        _mint(winner, rewars);
        emit FinishGameEvent(winner, rewars);
    }

    /**
     * @dev A function for the owner to change the commission.
     * @param newCommission The amount of the new commission..
     */
    function changeCommission(
        uint256 newCommission
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newCommission <= 0 || newCommission >= 100) {
            revert NotRightCommission(newCommission);
        }
        commissions = newCommission;
    }

    /**
     * @dev The function changes the ratios for exchanging rubies for tokens.
     * @param newConversion The amount of the new commission.
     */
    function changeConversion(
        uint256 newConversion
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newConversion <= 0) {
            revert NotRightCommission(newConversion);
        }
        conversion = newConversion;
    }
}
