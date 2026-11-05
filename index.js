import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
import { requireAuth } from "./jwt.js";

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

// Featured section: the home page calls this with the user's JWT
// (Authorization: Bearer <token>) — it is a protected API on purpose.
app.get("/featured", requireAuth, async (req, res) => {
  try {
    // `startAt` is an ISO-like string ("YYYY-MM-DDTHH:mm"), so string
    // comparison against an ISO "now" sorts correctly.
    const now = new Date().toISOString();
    const events = await eventsCollection
      .find({ publish: { $ne: false }, startAt: { $gt: now } })
      .sort({ startAt: 1 })
      .limit(6)
      .toArray();
    res.json(events);
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch featured events" });
  }
});

app.post("/add-event", requireAuth, async (req, res) => {
  try {
    // Ownership comes from the verified token, never from the request body.
    const event = {
      ...req.body,
      createdBy: req.user.email,
      joinedUsers: Array.isArray(req.body.joinedUsers)
        ? req.body.joinedUsers
        : [],
    };
    const result = await eventsCollection.insertOne(event);
    res.status(201).json({ success: true, insertedId: result.insertedId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to add event" });
  }
});

app.get("/events", async (req, res) => {
  try {
    // Optional filters: ?createdBy=<email> and/or ?joinedBy=<email>
    const query = {};
    const { createdBy, joinedBy } = req.query;
    if (createdBy) query.createdBy = createdBy;
    if (joinedBy) query.joinedUsers = joinedBy;
    const events = await eventsCollection
      .find(query)
      .sort({ startAt: 1 }) // upcoming (earliest) events first
      .toArray();
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

// Join / leave an event. The caller passes the logged-in user's email —
// the Express server intentionally knows nothing about better-auth sessions.
app.post("/events/:id/join", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const { email } = req.user || {};
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Token has no email claim" });
    }
    const result = await eventsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $addToSet: { joinedUsers: email } },
    );
    if (result.matchedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Failed to join event" });
  }
});

app.delete("/events/:id/join", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const { email } = req.user || {};
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Token has no email claim" });
    }
    const result = await eventsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $pull: { joinedUsers: email } },
    );
    if (result.matchedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Failed to leave event" });
  }
});

app.patch("/events/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    // Ownership guard: only the creator may update this event. Events created
    // after tracking was added carry a `createdBy` email; legacy docs without
    // one stay editable.
    const existingEvent = await eventsCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!existingEvent) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }
    if (existingEvent.createdBy && existingEvent.createdBy !== req.user.email) {
      return res.status(403).json({
        success: false,
        message: "You can only update events you created",
      });
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

app.delete("/events/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Invalid id" });
  }

  // Ownership guard: only the creator may delete this event (see PATCH above).
  const existingEvent = await eventsCollection.findOne({
    _id: new ObjectId(id),
  });
  if (!existingEvent) {
    return res
      .status(404)
      .json({ success: false, message: "Event not found" });
  }
  if (existingEvent.createdBy && existingEvent.createdBy !== req.user.email) {
    return res
      .status(403)
      .json({ success: false, message: "You can only delete events you created" });
  }

  const result = await eventsCollection.deleteOne({ _id: new ObjectId(id) });
  res.json(result);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
