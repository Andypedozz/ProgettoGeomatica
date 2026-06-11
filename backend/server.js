const express = require("express");
const cors = require("cors");
const tspRoutes = require("./routes/tsp");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use("/api/tsp", tspRoutes);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));