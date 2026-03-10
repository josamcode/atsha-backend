const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const clampNumber = (value, fallback, min, max) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
};

class PDFGenerator {
  constructor() {
    // Path to Arabic font (you'll need to add an Arabic font file)
    this.arabicFontPath = path.join(__dirname, '../fonts/NotoSansArabic-Regular.ttf');
  }

  buildPdfStyle(template = {}, organization = null) {
    const templatePdfStyle = template.pdfStyle || {};
    const templateBranding = templatePdfStyle.branding || {};
    const organizationBranding = organization?.branding || {};
    const organizationDisplayName = organizationBranding.displayName || organization?.name || 'atsha';

    return {
      ...templatePdfStyle,
      branding: {
        ...templateBranding,
        primaryColor: templateBranding.primaryColor || organizationBranding.primaryColor || templatePdfStyle.colors?.primary || '#d4b900',
        secondaryColor: templateBranding.secondaryColor || organizationBranding.secondaryColor || '#b51c20',
        logoUrl: templateBranding.logoUrl || organizationBranding.logoUrl,
        companyName: {
          en: templateBranding.companyName?.en || organizationDisplayName,
          ar: templateBranding.companyName?.ar || organizationDisplayName
        },
        companyAddress: {
          en: templateBranding.companyAddress?.en || organizationBranding.legalName || organizationDisplayName,
          ar: templateBranding.companyAddress?.ar || organizationBranding.legalName || organizationDisplayName
        },
        watermarkUrl: templateBranding.watermarkUrl || organizationBranding.watermarkUrl,
        companyPhone: templateBranding.companyPhone || organizationBranding.supportPhone,
        companyEmail: templateBranding.companyEmail || organizationBranding.supportEmail
      }
    };
  }

  getDepartmentLabel(organization, departmentCode, language = 'en') {
    const normalizedCode = String(departmentCode || '').trim().toLowerCase();
    const department = (organization?.departments || []).find((entry) => entry.code === normalizedCode);

    if (department?.name?.[language]) {
      return department.name[language];
    }

    if (department?.name?.en) {
      return department.name.en;
    }

    return departmentCode || '-';
  }

  async generateFormPDF(formInstance, template, user, language = 'en', options = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        // Get layout configuration from template
        const layout = template.layout || {};
        const pdfStyle = this.buildPdfStyle(template, options.organization || null);
        const pageSize = layout.pageSize || 'A4';
        const orientation = layout.orientation || 'portrait';
        const margins = layout.margins || { top: 50, right: 50, bottom: 50, left: 50 };

        const doc = new PDFDocument({
          size: pageSize,
          layout: orientation,
          margin: 0, // We'll handle margins manually
          bufferPages: true
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Register Arabic font if available
        if (fs.existsSync(this.arabicFontPath)) {
          doc.registerFont('Arabic', this.arabicFontPath);
        }

        const isRTL = language === 'ar';
        const title = template.title[language] || template.title.en;

        // Set initial position with margins
        doc.x = margins.left;
        doc.y = margins.top;

        // Header (if enabled)
        const headerConfig = pdfStyle.header || {};
        if (headerConfig.enabled !== false) {
          this.addHeader(doc, title, isRTL, pdfStyle, language, margins);
        }

        // General Information
        this.addGeneralInfo(doc, formInstance, user, language, isRTL, pdfStyle, margins, options.organization || null);
        doc.moveDown();

        // Form Sections - Use sectionOrder if available
        let sectionsToRender = template.sections;
        if (layout.sectionOrder && layout.sectionOrder.length > 0) {
          // Sort sections according to sectionOrder
          const sectionMap = new Map(template.sections.map(s => [s.id, s]));
          sectionsToRender = layout.sectionOrder
            .map(id => sectionMap.get(id))
            .filter(s => s !== undefined);

          // Add any sections not in sectionOrder
          const orderedIds = new Set(layout.sectionOrder);
          template.sections.forEach(section => {
            if (!orderedIds.has(section.id)) {
              sectionsToRender.push(section);
            }
          });
        }

        // Filter visible sections
        sectionsToRender = sectionsToRender.filter(section => section.visible !== false);

        sectionsToRender.forEach((section, index) => {
          this.addSection(doc, section, formInstance.values, language, isRTL, pdfStyle, margins);
          if (index < sectionsToRender.length - 1) {
            doc.moveDown();
          }
        });

        // Status and Approval
        this.addApprovalSection(doc, formInstance, language, isRTL, pdfStyle, margins);

        // Footer (if enabled)
        const footerConfig = pdfStyle.footer || {};
        if (footerConfig.enabled !== false) {
          await this.addFooter(doc, isRTL, pdfStyle, language, margins);
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  addHeader(doc, title, isRTL, pdfStyle, language, margins) {
    const headerConfig = pdfStyle.header || {};
    const branding = pdfStyle.branding || {};
    const headerHeight = headerConfig.height || 80;
    const headerBgColor = headerConfig.backgroundColor || '#ffffff';
    const headerTextColor = headerConfig.textColor || '#000000';
    const headerFontSize = headerConfig.fontSize || 16;
    const primaryColor = branding.primaryColor || pdfStyle.colors?.primary || '#d4b900';
    const companyName = branding.companyName?.[language] || branding.companyName?.en || 'atsha';

    // Draw header background
    doc.rect(margins.left, margins.top, doc.page.width - margins.left - margins.right, headerHeight)
      .fill(headerBgColor);

    let currentY = margins.top + 10;

    // Logo (if enabled and URL provided)
    if (headerConfig.showLogo !== false && branding.logoUrl) {
      // Note: PDFKit doesn't support image URLs directly, would need to download first
      // For now, we'll just show company name
    }

    // Company Name
    doc.fontSize(headerFontSize + 4)
      .fillColor(primaryColor)
      .text(companyName, margins.left, currentY, {
        align: headerConfig.logoPosition || 'left',
        width: doc.page.width - margins.left - margins.right
      });

    currentY = doc.y + 5;

    // Form Title (if enabled)
    if (headerConfig.showTitle !== false) {
      doc.fontSize(headerFontSize)
        .fillColor(headerTextColor)
        .text(title, margins.left, currentY, {
          align: headerConfig.logoPosition || 'left',
          width: doc.page.width - margins.left - margins.right
        });
      currentY = doc.y + 5;
    }

    // Date (if enabled)
    if (headerConfig.showDate !== false) {
      const dateText = isRTL
        ? `التاريخ: ${new Date().toLocaleDateString('ar-EG')}`
        : `Date: ${new Date().toLocaleDateString()}`;
      doc.fontSize(headerFontSize - 4)
        .fillColor(headerTextColor)
        .text(dateText, margins.left, currentY, {
          align: headerConfig.logoPosition || 'left',
          width: doc.page.width - margins.left - margins.right
        });
      currentY = doc.y + 5;
    }

    // Draw separator line
    doc.moveTo(margins.left, margins.top + headerHeight)
      .lineTo(doc.page.width - margins.right, margins.top + headerHeight)
      .strokeColor(primaryColor)
      .lineWidth(2)
      .stroke();

    // Update doc position
    doc.y = margins.top + headerHeight + 10;
  }

  addGeneralInfo(doc, formInstance, user, language, isRTL, pdfStyle, margins, organization = null) {
    const metadataConfig = pdfStyle.metadata || {};
    if (metadataConfig.enabled === false) {
      return;
    }

    const fontSize = pdfStyle.fontSize?.field || 10;
    const textColor = pdfStyle.colors?.text || '#000000';

    doc.fontSize(fontSize + 2).fillColor(textColor);

    const labels = {
      en: {
        formId: 'Form ID',
        date: 'Date',
        shift: 'Shift',
        department: 'Department',
        filledBy: 'Filled By',
        submittedOn: 'Submitted On',
        approvedBy: 'Approved By',
        approvalDate: 'Approval Date'
      },
      ar: {
        formId: 'رقم النموذج',
        date: 'التاريخ',
        shift: 'الوردية',
        department: 'القسم',
        filledBy: 'تم الملء بواسطة',
        submittedOn: 'تاريخ الإرسال',
        approvedBy: 'تم الاعتماد بواسطة',
        approvalDate: 'تاريخ الاعتماد'
      }
    };

    const lang = labels[language] || labels.en;

    const formatDateValue = (value) => {
      if (!value) {
        return '-';
      }

      const locale = language === 'ar' ? 'ar-EG' : 'en-US';
      return new Date(value).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    };

    const translateShift = (shift) => {
      if (!shift) {
        return '-';
      }

      const shiftLabels = {
        en: {
          morning: 'Morning',
          evening: 'Evening',
          night: 'Night'
        },
        ar: {
          morning: 'صباحي',
          evening: 'مسائي',
          night: 'ليلي'
        }
      };

      const localized = shiftLabels[language]?.[shift];
      return localized || shift;
    };

    const infoLines = [];

    if (metadataConfig.showFormId !== false) {
      infoLines.push(`${lang.formId}: #${String(formInstance._id || '').slice(-8) || '-'}`);
    }
    if (metadataConfig.showDate !== false) {
      infoLines.push(`${lang.date}: ${formatDateValue(formInstance.date)}`);
    }
    if (metadataConfig.showShift !== false) {
      infoLines.push(`${lang.shift}: ${translateShift(formInstance.shift)}`);
    }
    if (metadataConfig.showDepartment !== false) {
      infoLines.push(`${lang.department}: ${this.getDepartmentLabel(organization, formInstance.department, language)}`);
    }
    if (metadataConfig.showFilledBy !== false) {
      infoLines.push(`${lang.filledBy}: ${formInstance.filledBy?.name || user?.name || '-'}`);
    }
    if (metadataConfig.showSubmittedOn !== false) {
      infoLines.push(`${lang.submittedOn}: ${formatDateValue(formInstance.createdAt)}`);
    }
    if (formInstance.approvedBy && metadataConfig.showApprovedBy !== false) {
      infoLines.push(`${lang.approvedBy}: ${formInstance.approvedBy?.name || '-'}`);
    }
    if (formInstance.approvedBy && metadataConfig.showApprovalDate !== false) {
      infoLines.push(`${lang.approvalDate}: ${formatDateValue(formInstance.approvalDate)}`);
    }

    infoLines.forEach(line => {
      doc.text(line, margins.left, doc.y, {
        align: isRTL ? 'right' : 'left',
        width: doc.page.width - margins.left - margins.right
      });
    });
  }

  addSection(doc, section, values, language, isRTL, pdfStyle, margins) {
    // Skip if section is not visible
    if (section.visible === false) return;

    const sectionStyle = section.pdfStyle || {};
    const sectionSpacing = pdfStyle.spacing?.sectionSpacing || 20;
    const fieldSpacing = pdfStyle.spacing?.fieldSpacing || 10;
    const sectionFontSize = pdfStyle.fontSize?.section || 14;
    const fieldFontSize = pdfStyle.fontSize?.field || 10;
    const primaryColor = pdfStyle.colors?.primary || '#d4b900';
    const textColor = pdfStyle.colors?.text || '#000000';
    const borderColor = sectionStyle.borderColor || pdfStyle.colors?.border || '#e5e7eb';
    const backgroundColor = sectionStyle.backgroundColor || '#ffffff';

    // Check if we need a new page
    if (doc.y > doc.page.height - margins.bottom - 100) {
      doc.addPage();
      doc.y = margins.top;
    }

    // Section Header
    const sectionLabel = section.label[language] || section.label.en;
    const sectionType = section.sectionType || 'normal';

    // Apply section-specific styling based on sectionType
    if (sectionType === 'header') {
      // Header section - larger, centered
      doc.fontSize(sectionFontSize + 4)
        .fillColor(primaryColor)
        .text(sectionLabel, margins.left, doc.y, {
          align: 'center',
          width: doc.page.width - margins.left - margins.right
        });
      doc.y += sectionSpacing;
    } else {
      // Normal section
      // Draw section background if enabled
      if (sectionStyle.showBackground && backgroundColor !== '#ffffff') {
        doc.rect(margins.left, doc.y - 5, doc.page.width - margins.left - margins.right, sectionFontSize + 10)
          .fill(backgroundColor);
      }

      // Section title
      doc.fontSize(sectionFontSize)
        .fillColor(primaryColor)
        .text(sectionLabel, margins.left, doc.y, {
          align: isRTL ? 'right' : 'left',
          width: doc.page.width - margins.left - margins.right
        });

      // Draw border if enabled
      if (sectionStyle.showBorder !== false) {
        const borderWidth = sectionStyle.borderWidth || 1;
        doc.moveTo(margins.left, doc.y + 5)
          .lineTo(doc.page.width - margins.right, doc.y + 5)
          .strokeColor(borderColor)
          .lineWidth(borderWidth)
          .stroke();
      }

      doc.y += sectionSpacing / 2;
    }

    // Section Fields - Filter visible fields and sort by order
    let fieldsToRender = section.fields.filter(field => field.visible !== false);
    fieldsToRender.sort((a, b) => (a.order || 0) - (b.order || 0));

    fieldsToRender.forEach(field => {
      const fieldKey = `${section.id}.${field.key}`;
      const value = values.get ? values.get(fieldKey) : values[fieldKey];
      const fieldLabel = field.label[language] || field.label.en;

      // Skip if field PDF display is disabled
      if (field.pdfDisplay?.showValue === false && field.pdfDisplay?.showLabel === false) {
        return;
      }

      let displayValue = value !== undefined && value !== null
        ? value
        : (field.defaultValue?.[language] || field.defaultValue?.en || field.defaultValue?.ar || '-');

      // Format boolean values
      if (field.type === 'boolean') {
        displayValue = value ? (language === 'ar' ? 'نعم' : 'Yes') : (language === 'ar' ? 'لا' : 'No');
      }

      // Format date values
      if (field.type === 'date' && value) {
        displayValue = new Date(value).toLocaleDateString();
      }

      // Field display options
      const showLabel = field.pdfDisplay?.showLabel !== false;
      const showValue = field.pdfDisplay?.showValue !== false;
      const fieldFontSize = field.pdfDisplay?.fontSize || fieldFontSize;
      const isBold = field.pdfDisplay?.bold || false;

      // Build display text
      let displayText = '';
      if (showLabel && showValue) {
        displayText = `${fieldLabel}: ${displayValue}`;
      } else if (showLabel) {
        displayText = fieldLabel;
      } else if (showValue) {
        displayText = displayValue;
      }

      if (field.type === 'static_text' && showValue) {
        displayText = showLabel ? `${fieldLabel}: ${displayValue}` : displayValue;
      }

      if (displayText) {
        doc.fontSize(fieldFontSize)
          .fillColor(textColor);

        if (isBold) {
          doc.font('Helvetica-Bold');
        } else {
          doc.font('Helvetica');
        }

        doc.text(displayText, margins.left, doc.y, {
          align: isRTL ? 'right' : 'left',
          width: doc.page.width - margins.left - margins.right
        });

        doc.y += fieldSpacing;
      }
    });

    doc.y += sectionSpacing;
  }

  addApprovalSection(doc, formInstance, language, isRTL, pdfStyle, margins) {
    if (formInstance.status !== 'approved' || !formInstance.approvedBy) return;

    doc.y += pdfStyle.spacing?.sectionSpacing || 20;

    const fontSize = pdfStyle.fontSize?.field || 10;
    const textColor = pdfStyle.colors?.text || '#000000';
    const primaryColor = pdfStyle.colors?.primary || '#d4b900';

    const labels = {
      en: {
        approval: 'Approval Information',
        approvedBy: 'Approved By',
        approvalDate: 'Approval Date',
        notes: 'Notes'
      },
      ar: {
        approval: 'معلومات الموافقة',
        approvedBy: 'تمت الموافقة بواسطة',
        approvalDate: 'تاريخ الموافقة',
        notes: 'ملاحظات'
      }
    };

    const lang = labels[language] || labels.en;

    doc.fontSize(fontSize + 1)
      .fillColor(primaryColor)
      .text(lang.approval, margins.left, doc.y, {
        align: isRTL ? 'right' : 'left',
        width: doc.page.width - margins.left - margins.right
      });

    doc.y += 5;
    doc.fontSize(fontSize).fillColor(textColor);
    doc.text(`${lang.approvedBy}: ${formInstance.approvedBy.name || 'N/A'}`, margins.left, doc.y, {
      align: isRTL ? 'right' : 'left',
      width: doc.page.width - margins.left - margins.right
    });

    if (formInstance.approvalDate) {
      doc.y += 5;
      doc.text(`${lang.approvalDate}: ${new Date(formInstance.approvalDate).toLocaleString()}`, margins.left, doc.y, {
        align: isRTL ? 'right' : 'left',
        width: doc.page.width - margins.left - margins.right
      });
    }

    if (formInstance.approvalNotes) {
      doc.y += 5;
      doc.text(`${lang.notes}: ${formInstance.approvalNotes}`, margins.left, doc.y, {
        align: isRTL ? 'right' : 'left',
        width: doc.page.width - margins.left - margins.right
      });
    }
  }

  async addFooter(doc, isRTL, pdfStyle, language, margins) {
    const footerConfig = pdfStyle.footer || {};
    const branding = pdfStyle.branding || {};
    const showQRCode = footerConfig.showQRCode === true && String(footerConfig.qrCodeValue || '').trim();
    const qrCodeValue = String(footerConfig.qrCodeValue || '').trim();
    const footerTemplate = ['classic', 'centered', 'contact', 'minimal'].includes(footerConfig.template)
      ? footerConfig.template
      : 'classic';
    const qrCodePosition = footerTemplate === 'centered'
      ? 'center'
      : (footerConfig.qrCodePosition === 'left' ? 'left' : 'right');
    const qrCodeSize = showQRCode ? clampNumber(footerConfig.qrCodeSize, 40, 32, 96) : 0;
    const qrCodeBuffer = showQRCode
      ? await QRCode.toBuffer(qrCodeValue, { margin: 1, width: Math.max(120, qrCodeSize * 3) })
      : null;
    const qrCodeGap = qrCodeBuffer ? 14 : 0;
    const minimumHeight = qrCodeBuffer
      ? (footerTemplate === 'centered' ? qrCodeSize + 70 : 72)
      : 50;
    const footerHeight = Math.max(footerConfig.height || 50, minimumHeight);
    const footerBgColor = footerConfig.backgroundColor || '#f9fafb';
    const footerTextColor = footerConfig.textColor || '#6b7280';
    const footerFontSize = footerConfig.fontSize || 8;
    const pages = doc.bufferedPageRange();
    const companyName = branding.companyName?.[language] || branding.companyName?.en || 'atsha';
    const footerContent = footerConfig.content?.[language] || footerConfig.content?.en ||
      `${companyName} Restaurant Management System`;
    const phoneNumber = footerConfig.phoneNumber || branding.companyPhone || '';
    const socialLinks = footerConfig.showSocialIcons === true && Array.isArray(footerConfig.socialLinks)
      ? footerConfig.socialLinks.filter((link) => link?.url)
      : [];
    const footerExtras = [
      footerConfig.showPhoneNumber === true && phoneNumber ? phoneNumber : null,
      socialLinks.length > 0 ? socialLinks.map((link) => link.url).join(' | ') : null
    ].filter(Boolean).join(' | ');

    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);

      // Draw footer background
      doc.rect(margins.left, doc.page.height - margins.bottom - footerHeight,
        doc.page.width - margins.left - margins.right, footerHeight)
        .fill(footerBgColor);

      const footerTop = doc.page.height - margins.bottom - footerHeight;
      if (footerTemplate === 'centered') {
        let footerY = footerTop + 8;
        const contentWidth = doc.page.width - margins.left - margins.right;

        if (qrCodeBuffer) {
          const qrCodeX = margins.left + (contentWidth - qrCodeSize) / 2;
          doc.image(qrCodeBuffer, qrCodeX, footerY, {
            fit: [qrCodeSize, qrCodeSize]
          });
          footerY += qrCodeSize + 8;
        }

        if (footerConfig.showPageNumbers !== false) {
          const pageText = isRTL
            ? `\u0635\u0641\u062d\u0629 ${i + 1} \u0645\u0646 ${pages.count}`
            : `Page ${i + 1} of ${pages.count}`;

          doc.fontSize(footerFontSize)
            .fillColor(footerTextColor)
            .text(pageText, margins.left, footerY, {
              align: 'center',
              width: contentWidth
            });
          footerY += 13;
        }

        if (footerConfig.showCompanyInfo !== false) {
          doc.fontSize(footerFontSize)
            .fillColor(footerTextColor)
            .text(footerContent, margins.left, footerY, {
              align: 'center',
              width: contentWidth
            });
          footerY += 11;
        }

        if (footerExtras) {
          doc.fontSize(Math.max(footerFontSize - 1, 7))
            .fillColor(footerTextColor)
            .text(footerExtras, margins.left, footerY, {
              align: 'center',
              width: contentWidth
            });
        }

        continue;
      }

      const qrCodeX = qrCodeBuffer
        ? (qrCodePosition === 'left'
          ? margins.left + 10
          : doc.page.width - margins.right - qrCodeSize - 10)
        : null;
      const qrCodeY = qrCodeBuffer ? footerTop + (footerHeight - qrCodeSize) / 2 : null;
      const textX = qrCodeBuffer && qrCodePosition === 'left'
        ? margins.left + qrCodeSize + qrCodeGap
        : margins.left;
      const textWidth = qrCodeBuffer
        ? doc.page.width - margins.right - textX - (qrCodePosition === 'right' ? qrCodeSize + qrCodeGap : 0)
        : doc.page.width - margins.left - margins.right;
      let footerY = footerTop + 8;

      if (qrCodeBuffer) {
        doc.image(qrCodeBuffer, qrCodeX, qrCodeY, {
          fit: [qrCodeSize, qrCodeSize]
        });
      }

      // Page numbers (if enabled)
      if (footerConfig.showPageNumbers !== false) {
        const pageText = isRTL
          ? `\u0635\u0641\u062d\u0629 ${i + 1} \u0645\u0646 ${pages.count}`
          : `Page ${i + 1} of ${pages.count}`;

        doc.fontSize(footerFontSize)
          .fillColor(footerTextColor)
          .text(pageText, textX, footerY, {
            align: 'center',
            width: textWidth
          });
        footerY += 13;
      }

      // Company info (if enabled)
      if (footerConfig.showCompanyInfo !== false) {
        doc.fontSize(footerFontSize)
          .fillColor(footerTextColor)
          .text(footerContent, textX, footerY, {
            align: 'center',
            width: textWidth
          });
        footerY += 11;
      }

      if (footerExtras) {
        doc.fontSize(Math.max(footerFontSize - 1, 7))
          .fillColor(footerTextColor)
          .text(footerExtras, textX, footerY, {
            align: 'center',
            width: textWidth
          });
      }
    }
  }
}

module.exports = new PDFGenerator();

