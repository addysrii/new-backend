const {User} = require("../models/User");

function calculateMatch(a,b){

 const common = a.filter(s=>b.includes(s));

 return common.length / Math.max(a.length,1);

}

exports.getMatches = async(req,res)=>{

 const {lat,lng,distance=10000} = req.query;
 const userId = req.user.id;

 const currentUser = await User.findById(userId);

 const nearbyUsers = await User.find({

  _id:{$ne:userId},

  location:{
   $near:{
    $geometry:{
     type:"Point",
     coordinates:[parseFloat(lng),parseFloat(lat)]
    },
    $maxDistance:parseInt(distance)
   }
  }

 });

 const matches = nearbyUsers.map(u=>{

  const score = calculateMatch(
   currentUser.skills || [],
   u.skills || []
  );

  return{
   id:u._id,
   name:u.firstName,
   location:u.location.coordinates,
   matchScore:score
  };

 });

 res.json(matches);

}