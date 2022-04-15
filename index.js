require("dotenv").config();
const express = require("express");
const formidableMiddleware = require("express-formidable");
const mongoose = require("mongoose");
const cors = require("cors");

const SHA256 = require("crypto-js/sha256");
const encBase64 = require("crypto-js/enc-base64");
const uid2 = require("uid2");
const { stringify } = require("crypto-js/enc-base64");

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: "dldm9qwvd",
  api_key: "183974827523223",
  api_secret: "U-YgI7HvHb86j_R2MTqjeCxqAYI",
});

//connexion à la bdd
mongoose.connect(process.env.MONGODB_URI);

//Création du serveur
const app = express();
app.use(formidableMiddleware());
app.use(cors());
// Création du modèle User
const User = mongoose.model("User", {
  email: {
    unique: true,
    type: String,
  },
  account: {
    username: {
      required: true,
      type: String,
    },
    avatar: Object, // nous verrons plus tard comment uploader une image
  },
  newsletter: Boolean,
  token: String,
  hash: String,
  salt: String,
});

//route création user
app.post("/user/signup", async (req, res) => {
  try {
    //On vérifier qu'on envoie bien un username
    if (req.fields.username === undefined) {
      res.status(400).json({ message: "Missing parameter" });
    } else {
      //On vérifie que l'email en base de données soit bien disponible
      const isUserExist = await User.findOne({ email: req.fields.email });
      if (isUserExist !== null) {
        res.json({ message: "This email already has an account !" });
      } else {
        console.log(req.fields);
        //Etape 1 : hasher le mot de passe
        const salt = uid2(64);
        const hash = SHA256(req.fields.password + salt).toString(encBase64);
        const token = uid2(64);
        console.log("salt==>", salt);
        console.log("hash==>", hash);

        //Etape 2 : créer le nouvel utilisateur
        const newUser = new User({
          email: req.fields.email,
          account: {
            username: req.fields.username,
            // phone: req.fields.phone,
          },
          newsletter: req.fields.newsletter,
          token: token,
          hash: hash,
          salt: salt,
        });

        //Etape 3 : sauvegarder le nouvel utilisateur dans la bdd
        await newUser.save();
        res.json({
          _id: newUser._id,
          email: newUser.email,
          token: newUser.token,
          account: newUser.account,
        });
      }
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

//route login
app.post("/user/login", async (req, res) => {
  try {
    const userToCheck = await User.findOne({ email: req.fields.email });
    if (userToCheck === null) {
      res.status(401).json({ message: "Unauthorized ! 1" });
    } else {
      const newHash = SHA256(req.fields.password + userToCheck.salt).toString(
        encBase64
      );

      console.log("newHash==>", newHash);
      console.log("hashToCheck", userToCheck.hash);
      if (userToCheck.hash === newHash) {
        res.json({
          _id: userToCheck._id,
          token: userToCheck.token,
          account: userToCheck.account,
        });
      } else {
        res.status(401).json({ message: "Unauthorized ! 2" });
      }
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Création modèle Offer
const Offer = mongoose.model("Offer", {
  product_name: String,
  product_description: String,
  product_price: Number,
  city: String,
  product_brand: String,
  product_size: Number,
  product_color: String,
  product_image: { type: mongoose.Schema.Types.Mixed, default: {} },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
});

//Middleware - vérification que le user est bien identifié
const isAuthenticated = async (req, res, next) => {
  /* console.log(req.headers.authorization);
        console.log("Middleware isAuthenticated");
 */
  if (req.headers.authorization) {
    const checkUser = await User.findOne({
      token: req.headers.authorization.replace("Bearer ", ""),
    }).select("account");
    //console.log("checkuser", checkUser);
    if (checkUser) {
      req.checkUser = checkUser;
      next();
    } else {
      res.status(401).json({ error: "Unauthorized 1" });
    }
  } else {
    res.status(401).json({ error: "Unauthorized 2" });
  }
};

//Route creation d'annonce
app.post("/offer/publish", isAuthenticated, async (req, res) => {
  try {
    const newOffer = new Offer({
      product_name: req.fields.title,
      product_description: req.fields.description,
      product_price: req.fields.price,
      product_brand: req.fields.brand,
      product_size: req.fields.size,
      product_color: req.fields.color,
      city: req.fields.city,
      owner: req.checkUser,
    });

    //envoi de l'image sur cloudinary
    const result = await cloudinary.uploader.upload(req.files.picture.path, {
      folder: "vinted/offers",
      public_id: `${req.fields.title} - ${newOffer._id}`,
    });

    newOffer.product_image = result;

    await newOffer.save();
    res.json({ newOffer });

    console.log("Votre annonce a été créée", newOffer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

//Route Offers - filtres

app.get("/offers", async (req, res) => {
  try {
    const objectFilters = {};

    //Titre
    if (req.query.title) {
      objectFilters.product_name = new RegExp(req.query.title, "i");
    }
    if (req.query.priceMin) {
      objectFilters.product_price = { $gte: req.query.priceMin };
    }

    //Avec une clé product_price dans objectFilters
    if (req.query.priceMax) {
      if (objectFilters.product_price) {
        objectFilters.product_price.$lte = req.query.priceMax;
      } else {
        objectFilters.product_price = {
          $lte: req.query.priceMax,
        };
      }
    }
    //Tri
    const sortObject = {};
    if (req.query.sort === "price-desc") {
      sortObject.product_price = "desc";
    } else if (req.query.sort === "price-asc") {
      sortObject.product_price = "asc";
    }
    //console.log(objectFilters);

    //Pagination
    // On a par défaut 5 annonces par page
    //Si ma page est égale à 1 je devrais skip 0 annonces
    //Si ma page est égale à 2 je devrais skip 5 annonces
    //Si ma page est égale à 4 je devrais skip 15 annonces

    //(1-1) * 5 = skip 0 ==> PAGE 1
    //(2-1) * 5 = SKIP 5 ==> PAGE 2
    //(4-1) * 5 = SKIP 15 ==> PAGE 4
    // ==> (PAGE - 1) * LIMIT

    let limit = 3;
    if (req.query.limit) {
      limit = req.query.limit;
    }

    let page = 1;
    if (req.query.page) {
      page = req.query.page;
    }

    const offers = await Offer.find(objectFilters)
      .sort(sortObject)
      .skip((page - 1) * limit)
      .limit(limit)
      .select("product_name product_description product_price");

    const count = await Offer.find(objectFilters);

    res.json({ count: count, offers: offers });
  } catch (error) {
    res.status(400).json(error.message);
  }
});

app.all("*", (req, res) => {
  res.status(400).json("Route introuvable !");
});

app.listen(process.env.PORT, () => {
  console.log("Server has started ! ");
});
