const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SimpleSwap", function () {
    let SimpleSwap; // data contract needded for deployment
    let simpleSwap; // deployed contract

    let tokenA, tokenB, TokenA, TokenB;

    let owner, user1, addr1, user2;

    // beforeEach is excuted before each it
    // before is excuted only once and then runs every it
    before(async function () {
        [owner, user1, addr1, user2] = await ethers.getSigners();

        TokenA = await ethers.getContractFactory("TokenA");
        TokenB = await ethers.getContractFactory("TokenB");

        tokenA = await TokenA.deploy();
        await tokenA.waitForDeployment();

        tokenB = await TokenB.deploy();
        await tokenB.waitForDeployment();

        SimpleSwap = await ethers.getContractFactory("SimpleSwap");
        simpleSwap = await SimpleSwap.deploy(await tokenA.getAddress(), await tokenB.getAddress());

        await simpleSwap.waitForDeployment();

        // Mint tokens to addr1
        //await tokenA.mint(addr1.address, ethers.parseEther("1000"));
        //await tokenB.mint(addr1.address, ethers.parseEther("1000"));
        await tokenA.mint(addr1.address, 1000);
        await tokenB.mint(addr1.address, 1000);

        // Approve transferFrom to the contract
        await tokenA.connect(addr1).approve(
            await simpleSwap.getAddress(),
            1000n
        );
        await tokenB.connect(addr1).approve(
            await simpleSwap.getAddress(),
            1000n
        );

        // Mint tokens to user2 for swap
        await tokenA.mint(user2.address, 10);
        await tokenB.mint(user2.address, 10);

    });

    it("testing gettotalLiquidity()", async function () {
        let result = await simpleSwap.totalLiquidity();
        expect(result).to.equal("0");
    });

    it("testing getreserveA()", async function () {
        let result = await simpleSwap.reserveA();
        expect(result).to.equal("0");
    });

    it("testing getreserveB()", async function () {
        let result = await simpleSwap.reserveB();
        expect(result).to.equal("0");
    });

    it("testing mint()", async function () {
        const mintAmount = 100;
        await tokenA.connect(owner).mint(user1.address, mintAmount);
        let result = await tokenA.balanceOf(user1.address);
        expect(result).to.equal(mintAmount);
    });

    it("testing addLiquidity()", async () => {

        const amountA = 100n;
        const amountB = 200n;
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        const tx = await simpleSwap
            .connect(addr1)
            .addLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                amountA,
                amountB,
                amountA,
                amountB,
                addr1.address,
                deadline
            );


        const receipt = await tx.wait();
        const event = receipt.logs
            .map(log => {
                try {
                    return simpleSwap.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find(e => e && e.name === "LiquidityAdded");

        expect(event).to.not.be.undefined;

        const liquidityMinted = event.args.liquidityMinted;

        const expectedLiquidity = sqrtSolidityStyle(amountA * amountB);
        expect(liquidityMinted).to.equal(expectedLiquidity);

        const reservesA = await simpleSwap.reserveA();
        const reservesB = await simpleSwap.reserveB();
        const liquidity = await simpleSwap.totalLiquidity();
        const balance = await simpleSwap.liquidityBalance(addr1.address);

        expect(reservesA).to.equal(amountA);
        expect(reservesB).to.equal(amountB);
        expect(liquidity).to.equal(balance);
        expect(liquidity).to.be.gt(0n);
    });

    it("should emit LiquidityAdded event with correct values", async () => {
        const amountA = 100n;
        const amountB = 200n;
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        const tx = await simpleSwap
            .connect(addr1)
            .addLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                amountA,
                amountB,
                amountA,
                amountB,
                addr1.address,
                deadline
            );

        const receipt = await tx.wait();

        const event = receipt.logs
            .map(log => {
                try {
                    return simpleSwap.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find(e => e && e.name === "LiquidityAdded");

        expect(event).to.not.be.undefined;

        expect(event.args.provider).to.equal(addr1.address);
        expect(event.args.amountA).to.equal(amountA);
        expect(event.args.amountB).to.equal(amountB);

        // Para liquidityMinted, calculamos el esperado igual que en el contrato:
        const expectedLiquidity = sqrtSolidityStyle(amountA * amountB);
        expect(event.args.liquidityMinted).to.equal(expectedLiquidity);
    });

    it("should use amountAOptimal path in _calculateOptimalAmounts", async () => {
        // Inicialmente agregamos liquidez para tener reserves y totalLiquidity > 0
        const amountAInit = 100n;
        const amountBInit = 200n;
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        await simpleSwap.connect(addr1).addLiquidity(
            tokenA.target,
            tokenB.target,
            amountAInit,
            amountBInit,
            amountAInit,
            amountBInit,
            addr1.address,
            deadline
        );

        // Ahora hacemos otro addLiquidity con valores que disparen el `else`
        const amountADesired = 100n;
        const amountBDesired = 50n; // deliberately small so amountBOptimal > amountBDesired

        // amountBOptimal = (100 * 200) / 100 = 200 > 50 → entra al else

        await tokenA.connect(addr1).approve(simpleSwap.target, amountADesired);
        await tokenB.connect(addr1).approve(simpleSwap.target, amountBDesired);

        const tx = await simpleSwap.connect(addr1).addLiquidity(
            tokenA.target,
            tokenB.target,
            amountADesired,
            amountBDesired,
            1n,
            1n,
            addr1.address,
            deadline
        );

        const receipt = await tx.wait();
        const event = receipt.logs.map(log => {
            try {
                return simpleSwap.interface.parseLog(log);
            } catch {
                return null;
            }
        }).find(e => e?.name === "LiquidityAdded");

        expect(event).to.not.be.undefined;
    });

    it("should revert when amountA < amountAMin (slippage protection)", async () => {
        const amountADesired = 100n;
        const amountBDesired = 200n;
        const amountAMin = 150n; // > amountA que se calcularía
        const amountBMin = 100n;
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        await expect(
            simpleSwap.connect(addr1).addLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                amountADesired,
                amountBDesired,
                amountAMin,
                amountBMin,
                addr1.address,
                deadline
            )
        ).to.be.revertedWith("amountA < amountAMin");
    });

    it("should revert when amountB < amountBMin (slippage protection)", async () => {
        const amountADesired = 100n;
        const amountBDesired = 200n;
        const amountAMin = 50n;
        const amountBMin = 250n; // > amountB esperado
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        await expect(
            simpleSwap.connect(addr1).addLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                amountADesired,
                amountBDesired,
                amountAMin,
                amountBMin,
                addr1.address,
                deadline
            )
        ).to.be.revertedWith("amountB < amountBMin");
    });

    it("should revert if liquidity to mint is 0", async () => {
        const amountADesired = 0n;
        const amountBDesired = 0n;
        const amountAMin = 0n;
        const amountBMin = 0n;
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        await expect(
            simpleSwap.connect(addr1).addLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                amountADesired,
                amountBDesired,
                amountAMin,
                amountBMin,
                addr1.address,
                deadline
            )
        ).to.be.revertedWith("Insufficient liquidity minted");
    });

    it("testing getPrice()", async () => {
        const price = await simpleSwap.getPrice(
            await tokenA.getAddress(),
            await tokenB.getAddress()
        );

        // price es un número con 18 decimales
        expect(price).to.equal(ethers.parseUnits("2", 18));
    });

    it("should revert getPrice() when reserveA is zero", async () => {
        // Deploy un nuevo contrato vacío (sin liquidez)
        const SimpleSwapNew = await ethers.getContractFactory("SimpleSwap");
        const newSwap = await SimpleSwapNew.deploy(
            await tokenA.getAddress(),
            await tokenB.getAddress()
        );
        await newSwap.waitForDeployment();

        await expect(
            newSwap.getPrice(
                await tokenA.getAddress(),
                await tokenB.getAddress()
            )
        ).to.be.revertedWith("Zero reserveA");
    });

    it("testing getAmountOut()", async () => {
        const amountIn = 1n;

        const amountOut = await simpleSwap.getAmountOut(
            amountIn,
            await tokenA.getAddress(),
            await tokenB.getAddress()
        );

        // amountOut debe ser > 0 y menor a 3 ethers (un valor alto para cubrir la salida)
        expect(amountOut).to.be.gt(0);
        expect(amountOut).to.be.lt(3n);
    });

    it("should revert if amountIn is zero in getAmountOut()", async () => {
        await expect(
            simpleSwap.getAmountOut(
                0,
                100,
                200
            )
        ).to.be.revertedWith("Insufficient input amount");
    });

    it("should revert if amountA is zero in getAmountOut()", async () => {
        await expect(
            simpleSwap.getAmountOut(
                10,
                0,
                200
            )
        ).to.be.revertedWith("Insufficient liquidity");
    });

    it("should revert if amountB is zero in getAmountOut()", async () => {
        await expect(
            simpleSwap.getAmountOut(
                10,
                100,
                0
            )
        ).to.be.revertedWith("Insufficient liquidity");
    });

    it("should revert if deadline is in the past", async () => {
        const pastDeadline = (await ethers.provider.getBlock("latest")).timestamp - 10;

        await expect(
            simpleSwap.connect(user1).addLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                1n,
                2n,
                0,
                0,
                user1.address,
                pastDeadline
            )
        ).to.be.revertedWith("Transaction expired");
    });

    it("should swap TokenA for TokenB and emit TokensSwapped event", async function () {
        const amountIn = 10n;
        const path = [await tokenA.getAddress(), await tokenB.getAddress()];
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        // User approves SimpleSwap
        await tokenA.connect(user2).approve(simpleSwap, amountIn);

        const balanceBefore = await tokenB.balanceOf(user2.address);

        const tx = await simpleSwap.connect(user2).swapExactTokensForTokens(
            amountIn,
            0, // amountOutMin
            path,
            user2.address,
            deadline
        );

        const receipt = await tx.wait();
        const balanceAfter = await tokenB.balanceOf(user2.address);

        const amountOut = balanceAfter - balanceBefore;

        expect(amountOut).to.be.gt(0n);
        expect(balanceAfter).to.be.gt(balanceBefore);

        const event = receipt.logs
            .map(log => {
                try {
                    return simpleSwap.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find(e => e && e.name === "TokensSwapped" && e.args.swapper === user2.address);

        expect(event).to.not.be.undefined;

        expect(event.args.swapper).to.equal(user2.address);
        expect(event.args.amountIn).to.equal(amountIn);
        expect(event.args.tokenIn).to.equal(await tokenA.getAddress());
        expect(event.args.tokenOut).to.equal(await tokenB.getAddress());
    });

    it("should revert if amountIn is zero", async () => {
        const path = [await tokenA.getAddress(), await tokenB.getAddress()];

        await expect(
            simpleSwap.connect(user2).swapExactTokensForTokens(
                0n,
                0n,
                path,
                user2.address,
                (await ethers.provider.getBlock("latest")).timestamp + 60
            )
        ).to.be.revertedWith("Insufficient input amount");
    });

    it("should revert if amountOut < amountOutMin", async () => {
        const amountIn = 10n;
        const path = [await tokenA.getAddress(), await tokenB.getAddress()];
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        await tokenA.connect(user2).approve(simpleSwap, amountIn);

        // Simular una cantidad mínima inalcanzable para forzar el revert
        const amountOutMin = 1000n; // muy alta adrede

        await expect(
            simpleSwap.connect(user2).swapExactTokensForTokens(
                amountIn,
                amountOutMin, // <--- esta línea dispara el require
                path,
                user2.address,
                deadline
            )
        ).to.be.revertedWith("Insufficient output amount");
    });

    it("should revert if path length is not 2", async () => {
        await expect(
            simpleSwap.connect(user2).swapExactTokensForTokens(
                10n,
                0,
                [await tokenA.getAddress()], // invalid path
                user2.address,
                (await ethers.provider.getBlock("latest")).timestamp + 60
            )
        ).to.be.revertedWith("Path length must be 2");
    });

    it("should revert if token pair is invalid", async () => {
        const fakeToken = owner.address; // cualquier dirección que no sea tokenA/tokenB

        await expect(
            simpleSwap.connect(user2).swapExactTokensForTokens(
                10n,
                0,
                [fakeToken, await tokenB.getAddress()],
                user2.address,
                (await ethers.provider.getBlock("latest")).timestamp + 60
            )
        ).to.be.revertedWith("Invalid token pair");
    });

    it("should revert if amountA or amountB is less than minimums", async () => {
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;
        const userLiquidity = await simpleSwap.liquidityBalance(addr1.address);

        // Establecemos mínimos que sabemos serán más altos que lo que devolverá
        await expect(
            simpleSwap.connect(addr1).removeLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                userLiquidity,
                10_000n, // cantidad exageradamente alta
                10_000n,
                addr1.address,
                deadline
            )
        ).to.be.revertedWith("amountA < amountAMin");
    });





    it("testing removeLiquidity()", async () => {

        const amountAmin = 40n;
        const amountBmin = 80n;
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        const balanceBefore = await simpleSwap.liquidityBalance(addr1.address);
        const balanceABefore = await tokenA.balanceOf(addr1.address);
        const balanceBBefore = await tokenB.balanceOf(addr1.address);

        const reservesABefore = await simpleSwap.reserveA();
        const reservesBBefore = await simpleSwap.reserveB();

        const tx = await simpleSwap
            .connect(addr1)
            .removeLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                balanceBefore,
                amountAmin,
                amountBmin,
                addr1.address,
                deadline
            );

        const receipt = await tx.wait();
        const event = receipt.logs
            .map(log => {
                try {
                    return simpleSwap.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find(e => e && e.name === "LiquidityRemoved");

        expect(event).to.not.be.undefined;

        expect(event.args.amountA).to.be.gt(amountAmin);
        expect(event.args.amountB).to.be.gt(amountBmin);

        const balanceAfter = await simpleSwap.liquidityBalance(addr1.address);
        const balanceDiff = balanceBefore - balanceAfter;
        expect(balanceDiff).to.be.gt(0n);

        const balanceAAfter = await tokenA.balanceOf(addr1.address);
        const balanceADiff = balanceAAfter - balanceABefore;
        expect(balanceADiff).to.be.gt(0n);

        const balanceBAfter = await tokenB.balanceOf(addr1.address);
        const balanceBDiff = balanceBAfter - balanceBBefore;
        expect(balanceBDiff).to.be.gt(0n);

        const reservesAAfter = await simpleSwap.reserveA();
        const reservesADifff = reservesABefore - reservesAAfter;
        expect(reservesADifff).to.be.gt(0n);

        const reservesBAfter = await simpleSwap.reserveB();
        const reservesBDifff = reservesBBefore - reservesBAfter;
        expect(reservesBDifff).to.be.gt(0n);

    });

    it("should revert if 'Insufficient liquidity' ", async () => {
        const amountIn = 10n;
        const path = [await tokenA.getAddress(), await tokenB.getAddress()];
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

        await tokenA.connect(user2).approve(simpleSwap, amountIn);

        const amountOutMin = ethers.parseUnits("1000", 18);

        // Ya se removió la liquidez por eso va a revertir
        await expect(
            simpleSwap.connect(user2).swapExactTokensForTokens(
                amountIn,
                amountOutMin,
                path,
                user2.address,
                deadline
            )
        ).to.be.revertedWith("Insufficient liquidity");
    });

    it("should revert if liquidity to remove is zero", async () => {
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;
        await expect(
            simpleSwap.connect(addr1).removeLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                0, // ❌
                0,
                0,
                addr1.address,
                deadline
            )
        ).to.be.revertedWith("Zero liquidity");
    });

    it("should revert if user tries to remove more liquidity than owned", async () => {
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;
        const userLiquidity = await simpleSwap.liquidityBalance(addr1.address);

        await expect(
            simpleSwap.connect(addr1).removeLiquidity(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                userLiquidity + 1n, // ❌ más de lo que tiene
                0,
                0,
                addr1.address,
                deadline
            )
        ).to.be.revertedWith("Not enough liquidity");
    });






});

function sqrtSolidityStyle(x) {
    if (x === 0n) return 0n;

    let y = x;
    let z = (x + 1n) / 2n;

    while (z < y) {
        y = z;
        z = (x / z + z) / 2n;
    }

    return y;
}