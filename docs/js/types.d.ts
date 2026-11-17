// Namen die de site van buiten krijgt (config.js, Preact-modules), voor de typecontrole
interface Window { TRACKER_CONFIG?: any; PlanView?: any; NewsView?: any; }
// Safari op iPhone: of de site als app op het beginscherm draait
interface Navigator { standalone?: boolean; }
