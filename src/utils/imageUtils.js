const fs = require('fs');
const path = require('path');

const convertImageToBase64 = (imagePath) => {
  const absolutePath = path.resolve(__dirname, imagePath);
  const imageBuffer = fs.readFileSync(absolutePath);
  return `data:image/png;base64,${imageBuffer.toString('base64')}`;
};

module.exports = { convertImageToBase64 };