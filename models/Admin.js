import mongoose, { Schema } from "mongoose"
import express from "express"

const adminSchema = new Schema(
    {
name:{
    type:String,
    req:true,

},
email:{
       type:String,
    req:true,
},
password:{
    type:String,
    req:true,
},
isApproved:
{
    type:Boolean,
    default:false,
},

 

    }
)

const Admin =  mongoose.model('Admin',adminSchema)
module.exports = Admin
