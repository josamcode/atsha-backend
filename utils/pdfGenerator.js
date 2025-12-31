const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class PDFGenerator {
  constructor() {
    // Path to Arabic font (you'll need to add an Arabic font file)
    this.arabicFontPath = path.join(__dirname, '../fonts/NotoSansArabic-Regular.ttf');
  }

  async generateFormPDF(formInstance, template, user, language = 'en') {
    return new Promise((resolve, reject) => {
      try {
        // Get layout configuration from template
        const layout = template.layout || {};
        const pdfStyle = template.pdfStyle || {};
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
        const description = template.description?.[language] || template.description?.en || '';

        // Set initial position with margins
        doc.x = margins.left;
        doc.y = margins.top;

        // Header (if enabled)
        const headerConfig = pdfStyle.header || {};
        if (headerConfig.enabled !== false) {
          this.addHeader(doc, title, isRTL, pdfStyle, language, margins);
        }

        // General Information
        this.addGeneralInfo(doc, formInstance, user, language, isRTL, pdfStyle, margins);
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
          this.addFooter(doc, isRTL, pdfStyle, language, margins);
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

  addGeneralInfo(doc, formInstance, user, language, isRTL, pdfStyle, margins) {
    const fontSize = pdfStyle.fontSize?.field || 10;
    const textColor = pdfStyle.colors?.text || '#000000';

    doc.fontSize(fontSize + 2).fillColor(textColor);

    const labels = {
      en: {
        date: 'Date',
        filledBy: 'Filled By',
        department: 'Department',
        shift: 'Shift',
        status: 'Status'
      },
      ar: {
        date: 'التاريخ',
        filledBy: 'تم الملء بواسطة',
        department: 'القسم',
        shift: 'الوردية',
        status: 'الحالة'
      }
    };

    const lang = labels[language] || labels.en;

    const infoLines = [
      `${lang.date}: ${new Date(formInstance.date).toLocaleDateString()}`,
      `${lang.filledBy}: ${user.name}`,
      `${lang.department}: ${formInstance.department}`,
      `${lang.shift}: ${formInstance.shift}`,
      `${lang.status}: ${formInstance.status}`
    ];

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

      let displayValue = value !== undefined && value !== null ? value : '-';

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

  addFooter(doc, isRTL, pdfStyle, language, margins) {
    const footerConfig = pdfStyle.footer || {};
    const branding = pdfStyle.branding || {};
    const footerHeight = footerConfig.height || 50;
    const footerBgColor = footerConfig.backgroundColor || '#f9fafb';
    const footerTextColor = footerConfig.textColor || '#6b7280';
    const footerFontSize = footerConfig.fontSize || 8;
    const pages = doc.bufferedPageRange();

    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);

      // Draw footer background
      doc.rect(margins.left, doc.page.height - margins.bottom - footerHeight,
        doc.page.width - margins.left - margins.right, footerHeight)
        .fill(footerBgColor);

      let footerY = doc.page.height - margins.bottom - footerHeight + 10;

      // Page numbers (if enabled)
      if (footerConfig.showPageNumbers !== false) {
        const pageText = isRTL
          ? `صفحة ${i + 1} من ${pages.count}`
          : `Page ${i + 1} of ${pages.count}`;

        doc.fontSize(footerFontSize)
          .fillColor(footerTextColor)
          .text(pageText, margins.left, footerY, {
            align: 'center',
            width: doc.page.width - margins.left - margins.right
          });
        footerY += 15;
      }

      // Company info (if enabled)
      if (footerConfig.showCompanyInfo !== false) {
        const companyName = branding.companyName?.[language] || branding.companyName?.en || 'atsha';
        const footerContent = footerConfig.content?.[language] || footerConfig.content?.en ||
          `${companyName} Restaurant Management System`;

        doc.fontSize(footerFontSize)
          .fillColor(footerTextColor)
          .text(footerContent, margins.left, footerY, {
            align: 'center',
            width: doc.page.width - margins.left - margins.right
          });
      }
    }
  }
}

module.exports = new PDFGenerator();

