// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title AquaToken
 * @dev ERC-20 token with a fixed maximum supply and restricted minting.
 *      Only the designated faucet contract can mint new tokens.
 *      Built on OpenZeppelin's audited ERC20 implementation.
 */
contract AquaToken is ERC20 {
    /// @notice Maximum supply cap: 1,000,000 tokens (with 18 decimals)
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10 ** 18;

    /// @notice Address of the faucet contract authorized to mint tokens
    address public minter;

    /// @notice Address of the contract deployer / admin
    address public admin;

    /// @dev Restricts function access to the minter (faucet) only
    modifier onlyMinter() {
        require(msg.sender == minter, "AquaToken: caller is not the minter");
        _;
    }

    /// @dev Restricts function access to the admin only
    modifier onlyAdmin() {
        require(msg.sender == admin, "AquaToken: caller is not the admin");
        _;
    }

    /**
     * @notice Deploys the AquaToken contract.
     * @param _minter Address of the faucet contract that will be allowed to mint.
     */
    constructor(address _minter) ERC20("AquaToken", "AQUA") {
        require(_minter != address(0), "AquaToken: minter is zero address");
        minter = _minter;
        admin = msg.sender;
    }

    /**
     * @notice Mints new tokens to a recipient address.
     * @dev Only callable by the designated minter (faucet contract).
     *      Reverts if minting would exceed MAX_SUPPLY.
     * @param to The address to receive newly minted tokens.
     * @param amount The number of tokens to mint (in wei / base units).
     */
    function mint(address to, uint256 amount) external onlyMinter {
        require(
            totalSupply() + amount <= MAX_SUPPLY,
            "AquaToken: would exceed max supply"
        );
        _mint(to, amount);
    }

    /**
     * @notice Updates the minter address (e.g., to point to a new faucet).
     * @dev Only callable by the admin.
     * @param _newMinter The new minter address.
     */
    function setMinter(address _newMinter) external onlyAdmin {
        require(_newMinter != address(0), "AquaToken: minter is zero address");
        minter = _newMinter;
    }
}
