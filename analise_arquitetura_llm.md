# ANÁLISE DE ARQUITETURA END-TO-END: ECOSSISTEMA HUAWEI INTERSOLAR 2026

Este documento contém o mapeamento de engenharia, fluxos de dados e especificações técnicas do ecossistema cyberfísico desenvolvido para o estande da Huawei na Intersolar South America 2026. Ele foi estruturado para servir de contexto direto para agentes de IA (LLMs) interpretarem e estenderem o codebase.

---

## 1. Visão Geral do Sistema e Casos de Uso

O sistema gerencia ativações interativas no estande (ex: *Bike Energy*, *Fast Feet*, *Gerador de Manivela*):
1.  **Key Pass (Acesso)**: O visitante registra-se e vincula seu dispositivo NFC/QR Code a um sensor/máquina ativa.
2.  **Ingestão IoT**: ESP32s enviam telemetria física via MQTT para o servidor central NestJS.
3.  **Estado em Tempo Real**: O NestJS processa os dados, atualizando um cache temporário de sessão no Redis e emitindo atualizações instantâneas via WebSockets (Socket.io) para displays front-end e via UDP OSC para controlar efeitos gráficos no software Resolume Arena.
4.  **Encerramento e Ranking**: Ao término do tempo da partida, a rodada é gravada no banco PostgreSQL, a classificação geral é atualizada nos Sorted Sets do Redis, e a recompensa (brinde) é vinculada ao Key Pass.

---

## 2. Stack Tecnológica

*   **Runtime / Framework**: Node.js & NestJS v11 (híbrido: HTTP REST + Microserviço MQTT).
*   **Banco de Dados Relacional**: PostgreSQL gerenciado via Prisma ORM v7 (usando adaptador de driver `@prisma/adapter-pg` com o pooler `pg`).
*   **Cache e Ranking**: Redis (ioredis) para estado em cache de alta velocidade e Sorted Sets.
*   **IoT e Ingestão**: Broker Mosquitto MQTT local para telemetria de hardware (ESP32).
*   **Sincronização Multimídia**: Open Sound Control (OSC) via pacotes UDP (biblioteca `node-osc`) direcionado ao Resolume Arena (porta 7000).
*   **Comunicação Frontend**: WebSockets (Socket.io via `@nestjs/websockets`).

---

## 3. Mapeamento de Arquivos e Responsabilidades

```
c:\Users\ACER\Desktop\huawei
├── prisma/
│   └── schema.prisma         # Esquema relacional PostgreSQL (User, Session, Gift, GiftClaim)
├── src/
│   ├── main.ts               # Ponto de entrada híbrido (HTTP API na port 3000 + MQTT Microservice)
│   ├── app.module.ts         # Registro central de módulos injetados
│   ├── prisma.service.ts     # Gerenciador do ciclo de conexão Prisma v7 Pg Driver Adapter
│   ├── redis.service.ts      # Cliente de conexão ioredis local
│   ├── session/
│   │   ├── session.module.ts
│   │   ├── session.controller.ts # REST API (registro de usuários, vinculação NFC e leaderboards)
│   │   └── session.service.ts    # Lógica de sessões em Redis, gravação em Postgres e Sorted Sets
│   ├── mqtt/
│   │   ├── mqtt.module.ts
│   │   └── mqtt.controller.ts    # Consumidor do tráfego de telemetria dos ESP32
│   ├── socket/
│   │   ├── socket.module.ts
│   │   └── telemetry.gateway.ts  # Gateway WebSocket para atualização de telas locais
│   └── osc/
│       ├── osc.module.ts
│       └── osc.service.ts        # Ponte emissora de sinais OSC/UDP para o Resolume Arena
├── scripts/
│   ├── mqtt_emulator.py      # Simulador de mensagens MQTT de sensores ESP32 (Python)
│   └── osc_receiver.py       # Emulador e depurador de recepção de comandos OSC (Python)
└── .env                      # Arquivo de configuração de ambiente local
```

---

## 4. Fluxo de Dados e Protocolos de Mensagens (E2E)

### Passo A: Cadastro e Vinculação (NFC/QR Code)
O fluxo inicia quando um visitante é cadastrado na recepção e aproxima seu Key Pass do terminal de uma ativação:
*   **Endpoint**: `POST /session/bind`
*   **Payload**:
    ```json
    {
      "keyPassToken": "nfc_code_9876",
      "machineId": "bike_01",
      "activationType": "BIKE_ENERGY"
    }
    ```
*   **Ação**: O `SessionService` consulta o banco PostgreSQL. Se o visitante existe, abre uma chave no Redis `session:active:bike_01` contendo o estado zerado com expiração automática de 5 minutos (TTL 300).

### Passo B: Ingestão de Telemetria (MQTT)
O microcontrolador ESP32 na bicicleta lê a rotação da roda física e publica dados de telemetria via MQTT:
*   **Tópico**: `huawei/ativação/bike_01`
*   **Payload JSON**:
    ```json
    {
      "ativação": "bike_01",
      "cadencia": 85,
      "energia_acumulada": 12.5,
      "tempo_restante": 59.8
    }
    ```
*   **Processamento**: O NestJS captura a mensagem via `MqttController`, atualiza o estado incremental da chave no Redis (`KEEPTTL`) e calcula o delta.

### Passo C: Atualização Multimídia e Visual
A cada evento processado da telemetria (10Hz):
1.  **WebSockets**: Dispara para o frontend da tela local o evento `telemetry:bike_01` contendo o JSON atualizado para renderização da interface local.
2.  **Resolume (OSC)**: O `OscService` calcula o percentual gerado com base na meta final (ex: 1000W). Envia mensagens OSC UDP na porta `7000`:
    *   `/huawei/bike_01/energy` (float de `0.0` a `1.0` correspondendo à barra de progresso).
    *   `/huawei/bike_01/cadence` (cadência física instantânea).
    *   Se atingir 80% do alvo, dispara trigger para `/composition/columns/2/connect` (feedback visual progressivo).
    *   Se atingir 100%, dispara `/composition/columns/3/connect` (tela de recorde).

### Passo D: Conclusão da Partida
Quando `tempo_restante <= 0` é transmitido no payload MQTT:
1.  O `SessionService` encerra a sessão ativa.
2.  Persiste o registro completo no PostgreSQL na tabela `Session` via Prisma.
3.  Registra o score do visitante no Sorted Set correspondente do Redis (`leaderboard:BIKE_ENERGY`) usando a pontuação total.
4.  Remove a chave de sessão ativa (`DEL session:active:bike_01`).
5.  Notifica o cliente WebSocket com a mensagem socrática correspondente à conversão de energia.
6.  Envia sinal OSC `/huawei/active_trigger` com o valor `"GAME_OVER"`.

---

## 5. Modelagem de Dados

### Tabelas PostgreSQL (Prisma)
*   **`User`**: Nome, email, empresa, telefone, token exclusivo do Key Pass.
*   **`Session`**: Registro físico final das jogadas (ID do usuário, tipo de ativação, score total, resumo de métricas em JSON e status).
*   **`Gift`**: Gerenciamento de estoque físico dos brindes das marcas.
*   **`GiftClaim`**: Registro de qual visitante retirou qual brinde e o momento de débito.

### Cache Redis
*   **`session:active:<machineId>`**: Stringified JSON do estado de partida ativa (`userId`, `userName`, `score`, `cadence`, `timeRemaining`, `startedAt`).
*   **`leaderboard:<ActivationType>`**: Sorted Set (`ZADD`) ordenado pela pontuação final acumulada.

---

## 6. Configuração e Comandos Úteis

### Variáveis do `.env`
```env
PORT=3000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/huawei_intersolar?schema=public"
REDIS_HOST="localhost"
REDIS_PORT=6379
MQTT_HOST="localhost"
MQTT_PORT=1883
RESOLUME_HOST="localhost"
RESOLUME_PORT=7000
```

### Comandos de Build e Execução
*   Instalar dependências: `npm install`
*   Compilar aplicação: `npm run build`
*   Iniciar servidor em modo desenvolvimento: `npm run start:dev`

### Scripts Auxiliares de Testes (Simuladores Python)
1.  **Simular o Resolume Arena (Receptor OSC)**:
    ```bash
    python scripts/osc_receiver.py --port 7000
    ```
2.  **Simular ESP32 da Bicicleta (Emissor MQTT)**:
    ```bash
    python scripts/mqtt_emulator.py --machine bike_01 --duration 15
    ```
