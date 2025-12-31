const mongoose = require('mongoose');
const dotenv = require('dotenv');
const FormTemplate = require('../models/FormTemplate');
const connectDB = require('../config/db');

// Load environment variables
dotenv.config();

// Main function to update all templates
const updateTemplates = async () => {
  try {
    // Connect to database
    console.log('Connecting to database...');
    await connectDB();

    // Get all form templates
    console.log('Fetching all form templates...');
    const templates = await FormTemplate.find({});

    console.log(`Found ${templates.length} templates to process.`);

    let updatedCount = 0;
    let totalReplacements = 0;

    // Process each template
    for (const template of templates) {
      // Convert to plain object with ObjectIds as strings
      const templateObj = template.toObject({
        transform: (doc, ret) => {
          // Ensure ObjectIds are converted to strings
          if (ret._id && ret._id.toString) ret._id = ret._id.toString();
          if (ret.createdBy && ret.createdBy.toString) ret.createdBy = ret.createdBy.toString();
          return ret;
        }
      });

      // Convert to JSON string for color replacement
      const templateJson = JSON.stringify(templateObj);

      // Count occurrences before replacement (both colors)
      const beforeCountPrimary = (templateJson.match(/#dc2328/g) || []).length;
      const beforeCountSecondary = (templateJson.match(/#b51c20/g) || []).length;
      const beforeCount = beforeCountPrimary + beforeCountSecondary;

      if (beforeCount > 0) {
        // Replace colors in JSON string
        let updatedJson = templateJson
          .replace(/#dc2328/g, '#d4b900')
          .replace(/#b51c20/g, '#9e8b00');

        // Count occurrences after replacement
        const afterCountPrimary = (updatedJson.match(/#dc2328/g) || []).length;
        const afterCountSecondary = (updatedJson.match(/#b51c20/g) || []).length;
        const afterCount = afterCountPrimary + afterCountSecondary;
        const replacements = beforeCount - afterCount;

        // Parse back to object
        const updatedTemplate = JSON.parse(updatedJson);

        // Convert ObjectId strings back to ObjectId instances for fields that need them
        if (updatedTemplate.createdBy && typeof updatedTemplate.createdBy === 'string') {
          updatedTemplate.createdBy = new mongoose.Types.ObjectId(updatedTemplate.createdBy);
        }

        // Remove _id, __v, createdAt, updatedAt from update (these shouldn't be updated)
        const { _id, __v, createdAt, updatedAt, ...updateData } = updatedTemplate;

        // Update the template in database
        await FormTemplate.findByIdAndUpdate(
          template._id,
          { $set: updateData },
          { new: true, runValidators: true }
        );

        updatedCount++;
        totalReplacements += replacements;

        console.log(`✓ Updated template: ${template.title?.en || template.title?.ar || template._id} (${replacements} replacements)`);
      } else {
        console.log(`- Skipped template: ${template.title?.en || template.title?.ar || template._id} (no color to replace)`);
      }
    }

    console.log('\n========================================');
    console.log('Update Summary:');
    console.log(`Total templates processed: ${templates.length}`);
    console.log(`Templates updated: ${updatedCount}`);
    console.log(`Total color replacements: ${totalReplacements}`);
    console.log('========================================\n');

    // Close database connection
    await mongoose.connection.close();
    console.log('Database connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('Error updating templates:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

// Run the script
updateTemplates();
