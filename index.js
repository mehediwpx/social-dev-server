import express from "express";
import { MongoClient } from "mongodb";
import "dotenv/config";
import cors from "cors";

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Database Configuration
const client = new MongoClient(process.env.MONGODB_URL);
let eventsCollection;

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");

    const db = client.db("socialDevDB");
    eventsCollection = db.collection("events");

    return client;
  } catch (err) {
    console.error("MongoDB Connection Failed:", err);
  }
}

// Initialize database connection
await connectToMongoDB();

// POST route to handle form submission data from the client
// URL: http://localhost:5000/add-event
app.post("/add-event", async (req, res) => {
  try {
    // Guard clause if DB isn't initialized yet
    if (!eventsCollection) {
      return res.status(500).json({
        success: false,
        message: "Database not connected",
      });
    }

    const data = req.body;
    console.log("Data received from client:", data);

    // Insert data into your MongoDB events collection
    const result = await eventsCollection.insertOne(data);

    // Send exactly ONE clean JSON response back to the Next.js frontend
    return res.status(201).json({
      success: true,
      message: "Event added successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Error inserting event:", error);
    // Use return here to prevent any further code execution
    return res.status(500).json({
      success: false,
      message: "Failed to save event data",
    });
  }
});

// Test route to ensure server works
app.get("/", (req, res) => {
  res.send("Social Development Events Server is Running Running!");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
