import mongoose from "mongoose";

/**
 * Individual technology stack item
 */
const TechStackSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },
    level: {
      type: String,
      enum: [
        "Beginner (L1)",
        "Intermediate (L2)",
        "Advanced (L3)",
        "Expert (L4)"
      ],
      required: true
    },
    evidence: {
      type: String,
      required: true
    }
  },
  { _id: false }
);

/**
 * Technology domain (Frontend, Backend, etc.)
 */
const TechnologyDomainSchema = new mongoose.Schema(
  {
    domain: {
      type: String,
      required: true
    },
    stack: {
      type: [TechStackSchema],
      default: []
    }
  },
  { _id: false }
);

/**
 * Matching endpoints metadata
 */
const MatchingEndpointsSchema = new mongoose.Schema(
  {
    technical_similarity: {
      type: String,
      required: true
    },
    interest_similarity: {
      type: String,
      required: true
    },
    seniority_similarity: {
      type: String,
      required: true
    }
  },
  { _id: false }
);

/**
 * Root profile analysis schema
 */
const ProfileAnalysisSchema = new mongoose.Schema(
  {
    // Identity
    user_identifier: {
      type: String,
      required: true,
      index: true
    },

    // URLs used for inference
    source_urls: {
      type: [String],
      required: true
    },

    // AI model / logic reference
    knowledge_assessment_model: {
      type: String,
      required: true
    },

    // Core inferred data
    data_nodes: {
      technologies: {
        type: [TechnologyDomainSchema],
        default: []
      },
      matching_endpoints: {
        type: MatchingEndpointsSchema,
        required: true
      }
    },

    // Metadata
    confidence_score: {
      type: Number,
      min: 0,
      max: 1
    },

    // Versioning & audit
    prompt_version: {
      type: String,
      default: "v1"
    },

    ai_model: {
      type: String,
      default: "gpt-4.1-mini"
    },

    raw_ai_response: {
      type: Object // store full parsed JSON for traceability
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model(
  "ProfileAnalysis",
  ProfileAnalysisSchema
);
