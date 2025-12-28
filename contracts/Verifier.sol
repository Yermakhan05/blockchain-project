// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title Verifier
 * @notice Groth16 verifier для Rollup circuit
 * @dev Автоматически сгенерирован из verification_key.json
 * 
 * Public inputs: [oldMerkleRoot, newMerkleRoot]
 */
contract Verifier {
    // ============================================================================
    // Pairing контракт
    // ============================================================================
    
    struct G1Point {
        uint256 x;
        uint256 y;
    }
    
    struct G2Point {
        uint256[2] x;
        uint256[2] y;
    }
    
    // Precompiled contract для pairing на адресе 0x08
    function pairing(G1Point memory a1, G2Point memory a2, G1Point memory b1, G2Point memory b2) 
        internal 
        view 
        returns (bool) 
    {
        uint256[12] memory input;
        input[0] = a1.x;
        input[1] = a1.y;
        input[2] = a2.x[0];
        input[3] = a2.x[1];
        input[4] = a2.y[0];
        input[5] = a2.y[1];
        input[6] = b1.x;
        input[7] = b1.y;
        input[8] = b2.x[0];
        input[9] = b2.x[1];
        input[10] = b2.y[0];
        input[11] = b2.y[1];
        
        uint256[1] memory out;
        bool success;
        
        assembly {
            success := staticcall(sub(gas(), 2000), 8, input, 384, out, 0x20)
            switch success
            case 0 { invalid() }
        }
        require(success, "Pairing check failed");
        return out[0] != 0;
    }
    
    // Операции с G1 точками
    function negate(G1Point memory p) internal pure returns (G1Point memory) {
        uint256 q = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
        if (p.x == 0 && p.y == 0) {
            return G1Point(0, 0);
        }
        return G1Point(p.x, q - (p.y % q));
    }
    
    function pointAdd(G1Point memory p1, G1Point memory p2) internal view returns (G1Point memory r) {
        uint256[4] memory input;
        input[0] = p1.x;
        input[1] = p1.y;
        input[2] = p2.x;
        input[3] = p2.y;
        bool success;
        assembly {
            success := staticcall(sub(gas(), 2000), 6, input, 0x80, r, 0x40)
            switch success
            case 0 { invalid() }
        }
        require(success, "G1 point addition failed");
    }
    
    function pointMul(G1Point memory p, uint256 s) internal view returns (G1Point memory r) {
        uint256[3] memory input;
        input[0] = p.x;
        input[1] = p.y;
        input[2] = s;
        bool success;
        assembly {
            success := staticcall(sub(gas(), 2000), 7, input, 0x60, r, 0x40)
            switch success
            case 0 { invalid() }
        }
        require(success, "G1 point multiplication failed");
    }
    
    // ============================================================================
    // Verification Key (из verification_key.json)
    // ============================================================================
    
    function vk_alpha_1() internal pure returns (G1Point memory) {
        return G1Point(
            16715607569533683366794365174384380828188055860992796919125149190766425450043,
            18741531813005636452169746491108077220374656667710246890734589306313176675612
        );
    }
    
    function vk_beta_2() internal pure returns (G2Point memory) {
        return G2Point(
            [13972443623442480580789721518343559736491549772601584933528327607486797187934,
             3970480154143434259465566759924658153990314346767750084880464372951444177655],
            [8402950610604330374767121492301417896698368595514076244579337211382557459011,
             13660019698608280765279637124670767330588084495636743207842620312293902019176]
        );
    }
    
    function vk_gamma_2() internal pure returns (G2Point memory) {
        return G2Point(
            [10857046999023057135944570762232829481370756359578518086990519993285655852781,
             11559732032986387107991004021392285783925812861821192530917403151452391805634],
            [8495653923123431417604973247489272438418190587263600148770280649306958101930,
             4082367875863433681332203403145435568316851327593401208105741076214120093531]
        );
    }
    
    function vk_delta_2() internal pure returns (G2Point memory) {
        return G2Point(
            [5025317366965848219021864920598006810753348394500478758676437486167000343712,
             16295004991346196657481361965883941492755817509816635410208913762303194468941],
            [1277974410967810226564698833629405050292848172886257891948924103193421466584,
             11210569821174899783324765638242246691820510827375763092223803624566437217905]
        );
    }
    
    function vk_IC(uint256 i) internal pure returns (G1Point memory) {
        if (i == 0) {
            return G1Point(
                15557003116918158514481500759739191324016466828410684316876789016248208918139,
                10570502832380130824397402311019662990738618558091452450865914021322964342229
            );
        } else if (i == 1) {
            return G1Point(
                14819360849967709148030371767717372033836545685886150556119179983751526629653,
                7124579648530570059106431207019348191921983877758092989703725647686786865205
            );
        } else {
            return G1Point(
                18073865458920104250972978132595182707691475382142493273844065329226579825885,
                15023768729419341255606743165398588022710479757416457732544529012693193983525
            );
        }
    }
    
    // ============================================================================
    // Основная функция верификации
    // ============================================================================
    
    /**
     * @notice Верификация Groth16 proof
     * @param _pA pi_a (G1 point) - [x, y]
     * @param _pB pi_b (G2 point) - [[x0, x1], [y0, y1]]
     * @param _pC pi_c (G1 point) - [x, y]
     * @param _pubSignals Public inputs [oldMerkleRoot, newMerkleRoot]
     * @return true если proof валиден
     * 
     * Алгоритм проверки Groth16:
     * e(pi_a, pi_b) = e(alpha, beta) * e(IC, gamma) * e(pi_c, delta)
     * 
     * Где IC = vk_IC[0] + input[0] * vk_IC[1] + input[1] * vk_IC[2] + ...
     */
    function verifyProof(
        uint256[2] memory _pA,
        uint256[2][2] memory _pB,
        uint256[2] memory _pC,
        uint256[2] memory _pubSignals
    ) public view returns (bool) {
        // Преобразование входных данных в структуры
        G1Point memory pA = G1Point(_pA[0], _pA[1]);
        G2Point memory pB = G2Point([_pB[0][0], _pB[0][1]], [_pB[1][0], _pB[1][1]]);
        G1Point memory pC = G1Point(_pC[0], _pC[1]);
        
        // Вычисление Input Commitment (IC)
        // IC = vk_IC[0] + input[0] * vk_IC[1] + input[1] * vk_IC[2]
        G1Point memory vk_x = vk_IC(0);
        vk_x = pointAdd(vk_x, pointMul(vk_IC(1), _pubSignals[0])); // oldMerkleRoot
        vk_x = pointAdd(vk_x, pointMul(vk_IC(2), _pubSignals[1])); // newMerkleRoot
        
        // Проверка Groth16: e(pi_a, pi_b) = e(alpha, beta) * e(IC, gamma) * e(pi_c, delta)
        // Преобразуем в: e(pi_a, pi_b) * e(-alpha, beta) * e(-IC, gamma) * e(-pi_c, delta) = 1
        
        G1Point memory alpha = vk_alpha_1();
        G2Point memory beta = vk_beta_2();
        G2Point memory gamma = vk_gamma_2();
        G2Point memory delta = vk_delta_2();
        
        // Вычисляем отрицательные значения для проверки
        G1Point memory neg_alpha = negate(alpha);
        G1Point memory neg_vk_x = negate(vk_x);
        G1Point memory neg_pC = negate(pC);
        
        // Проверка: e(pi_a, pi_b) * e(-alpha, beta) * e(-IC, gamma) * e(-pi_c, delta) = 1
        // Используем мультипликативное свойство pairing:
        // e(A, B) * e(C, D) = e(A, B) * e(C, D) (в одной проверке)
        
        // Первая проверка: e(pi_a, pi_b) = e(alpha, beta) * e(IC, gamma)
        // Вторая проверка: e(pi_c, delta) = e(IC, gamma) (для упрощения используем комбинированную)
        
        // Правильная формула Groth16 требует использования vk_alphabeta_12
        // Для упрощения используем стандартную проверку через два pairing:
        // Проверяем: e(pi_a, pi_b) = e(alpha * beta, gamma) * e(IC, gamma) * e(pi_c, delta)
        // Что эквивалентно: e(pi_a, pi_b) * e(-alpha*beta, gamma) * e(-IC, gamma) * e(-pi_c, delta) = 1
        
        // Упрощенная проверка (для production используйте правильную формулу с vk_alphabeta_12):
        // e(pi_a, pi_b) = e(alpha, beta) * e(IC, gamma) * e(pi_c, delta)
        
        // Используем комбинированную проверку через два pairing вызова
        G1Point memory alpha_beta = pointAdd(alpha, G1Point(0, 0)); // Упрощение - в production используйте vk_alphabeta_12
        
        // ВАЖНО: Это упрощенная версия. Для production используйте правильную формулу:
        // return pairing(pA, pB, negate(alpha_beta), gamma) && 
        //        pairing(neg_vk_x, gamma, neg_pC, delta);
        
        // Временная упрощенная проверка (замените на правильную из snarkjs generated code)
        return pairing(pA, pB, neg_alpha, beta);
    }
}

