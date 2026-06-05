const Service = require("node-windows").Service;

// Create a new service object
const svc = new Service({
	name: "ioBroker",
	script: require("node:path").join(__dirname, "controller.js"), // Corrected to node:path
});

// Listen for the "uninstall" event, so we know when it's done.
svc.on("uninstall", () => {
	console.log("Uninstall complete.");
	console.log("The service exists: ", svc.exists);
});

// Uninstall the service.
svc.uninstall();
