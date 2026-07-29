'use strict';
// Minimaler Fake-Modbus-TCP-Server für den 0.9.4 controlEnabled-Test auf victron-gx.1.
// Beantwortet JEDE Holding-Register-Lese-/Schreibanfrage auf JEDER Unit-ID mit 0 - reicht aus,
// damit discoverModbusUnits()/initControlDatapoints() im echten Adapter-Code erfolgreich durchlaufen
// (Werte selbst sind für den Objekt-Erzeugungstest irrelevant). Nur für diesen manuellen Test,
// nicht Teil des Adapters.
const { ServerTCP } = require('modbus-serial');

const vector = {
    getHoldingRegister: (_addr, _unitID) => 0,
    setRegister: (_addr, _value, _unitID) => {},
};

const server = new ServerTCP(vector, { host: '127.0.0.1', port: 502, debug: false, unitID: 255 });
server.on('socketError', err => console.error('socketError', err.message));
console.log('Fake Modbus TCP server listening on 127.0.0.1:502 (answers every unit ID with 0)');
