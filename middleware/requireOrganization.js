const requireOrganization = (req, res, next) => {
  if (req.organization) {
    return next();
  }

  if (req.organizationResolution?.error === 'not_found') {
    return res.status(404).json({
      success: false,
      message: 'Organization not found'
    });
  }

  return res.status(400).json({
    success: false,
    message: 'Organization context is required'
  });
};

module.exports = requireOrganization;
