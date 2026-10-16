// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Groth16Verifier
/// @notice Verifies Groth16 proofs for Merkle tree membership (2 public inputs: root, leaf hash).
/// @dev Follows the snarkjs-generated verifier structure with BN254 pairing checks.
contract Groth16Verifier {
    error InvalidProof();
    error InvalidPublicInputCount();

    uint256 internal constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant PRIME_Q =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    struct VerifyingKey {
        G1Point alpha1;
        G2Point beta2;
        G2Point gamma2;
        G2Point delta2;
        G1Point[] ic; // length = nPublicInputs + 1
    }

    struct Proof {
        G1Point a;
        G2Point b;
        G1Point c;
    }

    struct G1Point {
        uint256 x;
        uint256 y;
    }

    struct G2Point {
        uint256[2] x;
        uint256[2] y;
    }

    // Placeholder verification key -- replace with actual ceremony output.
    // These are valid BN254 generator points for structural correctness.
    function verifyingKey() internal pure returns (VerifyingKey memory vk) {
        vk.alpha1 = G1Point(
            20491192805390485299153009773594534940189261866228447918068658471970481763042,
            9383485363053290200918347156157836566562967994039712273449902621266178545958
        );
        vk.beta2 = G2Point(
            [4252822878758300859123897981450591353533073413197771768651442665752259397132,
             6375614351688725206403948262868962793625744043794305715222011528459656738731],
            [21847035105528745403288232691147584728191162732299865338377159692350059136679,
             10505242626370262277552901082094356697409835680220590971873171140371331206856]
        );
        vk.gamma2 = G2Point(
            [11559732032986387107991004021392285783925812861821192530917403151452391805634,
             10857046999023057135944570762232829481370756359578518086990519993285655852781],
            [4082367875863433681332203403145435568316851327593401208105741076214120093531,
             8495653923123431417604973247489272438418190587263600148770280649306958101930]
        );
        vk.delta2 = G2Point(
            [11559732032986387107991004021392285783925812861821192530917403151452391805634,
             10857046999023057135944570762232829481370756359578518086990519993285655852781],
            [4082367875863433681332203403145435568316851327593401208105741076214120093531,
             8495653923123431417604973247489272438418190587263600148770280649306958101930]
        );
        vk.ic = new G1Point[](3); // 2 public inputs + 1
        vk.ic[0] = G1Point(
            6819801395408938350212900248749732364821477541620635511814266536599629892365,
            9092252330033992554755034971584864587974280972948086568597554018278568571960
        );
        vk.ic[1] = G1Point(
            17882351432079341047610988279187702204876977081278321838421635109316786685818,
            5765811523082952599614572507844682494503654131444457199725535537036724411928
        );
        vk.ic[2] = G1Point(
            10060004714591227724274806090110082399150066792549898888075084220825795498488,
            5280738018133368717621796092803348628853024619851694741849024503795144437808
        );
    }

    /// @notice Verifies a Groth16 proof against 2 public inputs.
    /// @param proof The encoded proof (a, b, c points).
    /// @param pubInputs Array of 2 public inputs [merkleRoot, leafHash].
    /// @return True if the proof is valid.
    function verifyProof(
        uint256[8] calldata proof,
        uint256[2] calldata pubInputs
    ) external view returns (bool) {
        for (uint256 i = 0; i < 2; i++) {
            if (pubInputs[i] >= SNARK_SCALAR_FIELD) revert InvalidProof();
        }

        Proof memory p = Proof(
            G1Point(proof[0], proof[1]),
            G2Point([proof[2], proof[3]], [proof[4], proof[5]]),
            G1Point(proof[6], proof[7])
        );

        VerifyingKey memory vk = verifyingKey();

        // Compute linear combination of public inputs: vk_x = ic[0] + sum(pubInputs[i] * ic[i+1])
        G1Point memory vkX = vk.ic[0];
        for (uint256 i = 0; i < 2; i++) {
            vkX = addition(vkX, scalar_mul(vk.ic[i + 1], pubInputs[i]));
        }

        // Pairing check: e(A, B) == e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
        // Rearranged: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
        return pairing(
            negate(p.a), p.b,
            vk.alpha1, vk.beta2,
            vkX, vk.gamma2,
            p.c, vk.delta2
        );
    }

    // -- BN254 elliptic curve operations --

    function negate(G1Point memory p) internal pure returns (G1Point memory) {
        if (p.x == 0 && p.y == 0) return G1Point(0, 0);
        return G1Point(p.x, PRIME_Q - (p.y % PRIME_Q));
    }

    function addition(G1Point memory p1, G1Point memory p2) internal view returns (G1Point memory r) {
        uint256[4] memory input;
        input[0] = p1.x;
        input[1] = p1.y;
        input[2] = p2.x;
        input[3] = p2.y;
        bool success;
        assembly {
            success := staticcall(sub(gas(), 2000), 6, input, 0x80, r, 0x40)
        }
        if (!success) revert InvalidProof();
    }

    function scalar_mul(G1Point memory p, uint256 s) internal view returns (G1Point memory r) {
        uint256[3] memory input;
        input[0] = p.x;
        input[1] = p.y;
        input[2] = s;
        bool success;
        assembly {
            success := staticcall(sub(gas(), 2000), 7, input, 0x60, r, 0x40)
        }
        if (!success) revert InvalidProof();
    }

    /// @dev Performs a 4-pairing product check via the bn256Pairing precompile (address 8).
    function pairing(
        G1Point memory a1, G2Point memory a2,
        G1Point memory b1, G2Point memory b2,
        G1Point memory c1, G2Point memory c2,
        G1Point memory d1, G2Point memory d2
    ) internal view returns (bool) {
        uint256[24] memory input = [
            a1.x, a1.y, a2.x[1], a2.x[0], a2.y[1], a2.y[0],
            b1.x, b1.y, b2.x[1], b2.x[0], b2.y[1], b2.y[0],
            c1.x, c1.y, c2.x[1], c2.x[0], c2.y[1], c2.y[0],
            d1.x, d1.y, d2.x[1], d2.x[0], d2.y[1], d2.y[0]
        ];
        uint256[1] memory out;
        bool success;
        assembly {
            success := staticcall(sub(gas(), 2000), 8, input, 0x300, out, 0x20)
        }
        if (!success) revert InvalidProof();
        return out[0] != 0;
    }
}
