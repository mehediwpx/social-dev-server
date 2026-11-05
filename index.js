import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URL);
let eventsCollection;

async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    eventsCollection = client.db("socialDevDB").collection("events");
  } catch (err) {
    console.error("MongoDB Connection Failed:", err);
    process.exit(1);
  }
}

await connectToMongoDB();

app.get("/", (req, res) => {
  res.send("Social Development Events Server is Running!");
});

app.post("/add-event", async (req, res) => {
  try {
    const result = await eventsCollection.insertOne(req.body);
    res.status(201).json({ success: true, insertedId: result.insertedId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to add event" });
  }
});

app.get("/events", async (req, res) => {
  try {
    const events = await eventsCollection.find({}).toArray();
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch events" });
  }
});

app.get("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const event = await eventsCollection.findOne({ _id: new ObjectId(id) });
    if (!event) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }
    res.json(event);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch event" });
  }
});

app.patch("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const { _id, ...updatedData } = req.body;
    const result = await eventsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData },
    );
    if (result.matchedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update event" });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
