const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

const Role = require('./role.model')(sequelize, DataTypes);
const User = require('./user.model')(sequelize, DataTypes);
const Coach = require('./coach.model')(sequelize, DataTypes);
const ClientProfile = require('./clientProfile.model')(sequelize, DataTypes);
const SportCategory = require('./sportCategory.model')(sequelize, DataTypes);
const CoachSpecialization = require('./coachSpecialization.model')(sequelize, DataTypes);
const Availability = require('./availability.model')(sequelize, DataTypes);
const TimeSlot = require('./timeSlot.model')(sequelize, DataTypes);
const Booking = require('./booking.model')(sequelize, DataTypes);
const Payment = require('./payment.model')(sequelize, DataTypes);
const Review = require('./review.model')(sequelize, DataTypes);
const Notification = require('./notification.model')(sequelize, DataTypes);
const Message = require('./message.model')(sequelize, DataTypes);
const Court = require('./court.model')(sequelize, DataTypes);

// ---- Associations ----

// Role <-> User
Role.hasMany(User, { foreignKey: 'roleId', as: 'users' });
User.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });

// User <-> Coach (1:1)
User.hasOne(Coach, { foreignKey: 'userId', as: 'coachProfile', onDelete: 'CASCADE' });
Coach.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// User <-> ClientProfile (1:1)
User.hasOne(ClientProfile, { foreignKey: 'userId', as: 'clientProfile', onDelete: 'CASCADE' });
ClientProfile.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Coach <-> SportCategory (M:N via CoachSpecialization)
Coach.hasMany(CoachSpecialization, { foreignKey: 'coachId', as: 'specializations', onDelete: 'CASCADE' });
CoachSpecialization.belongsTo(Coach, { foreignKey: 'coachId', as: 'coach' });
SportCategory.hasMany(CoachSpecialization, { foreignKey: 'sportCategoryId', as: 'coachLinks' });
CoachSpecialization.belongsTo(SportCategory, { foreignKey: 'sportCategoryId', as: 'sportCategory' });

// Coach <-> Availability
Coach.hasMany(Availability, { foreignKey: 'coachId', as: 'availabilities', onDelete: 'CASCADE' });
Availability.belongsTo(Coach, { foreignKey: 'coachId', as: 'coach' });

// Coach <-> TimeSlot
Coach.hasMany(TimeSlot, { foreignKey: 'coachId', as: 'timeSlots', onDelete: 'CASCADE' });
TimeSlot.belongsTo(Coach, { foreignKey: 'coachId', as: 'coach' });

// TimeSlot <-> Booking (1:1)
TimeSlot.hasOne(Booking, { foreignKey: 'timeSlotId', as: 'booking' });
Booking.belongsTo(TimeSlot, { foreignKey: 'timeSlotId', as: 'timeSlot' });

// User(client) <-> Booking, Coach <-> Booking
User.hasMany(Booking, { foreignKey: 'clientId', as: 'clientBookings' });
Booking.belongsTo(User, { foreignKey: 'clientId', as: 'client' });
Coach.hasMany(Booking, { foreignKey: 'coachId', as: 'bookings' });
Booking.belongsTo(Coach, { foreignKey: 'coachId', as: 'coach' });
SportCategory.hasMany(Booking, { foreignKey: 'sportCategoryId', as: 'bookings' });
Booking.belongsTo(SportCategory, { foreignKey: 'sportCategoryId', as: 'sportCategory' });
Court.hasMany(Booking, { foreignKey: 'courtId', as: 'bookings' });
Booking.belongsTo(Court, { foreignKey: 'courtId', as: 'court' });

// Self-reference for rescheduling history
Booking.belongsTo(Booking, { foreignKey: 'rescheduledFromId', as: 'rescheduledFrom' });

// Booking <-> Payment (1:1)
Booking.hasOne(Payment, { foreignKey: 'bookingId', as: 'payment', onDelete: 'CASCADE' });
Payment.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' });

// Booking <-> Review (1:1), User/Coach <-> Review
Booking.hasOne(Review, { foreignKey: 'bookingId', as: 'review', onDelete: 'CASCADE' });
Review.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' });
User.hasMany(Review, { foreignKey: 'clientId', as: 'reviewsWritten' });
Review.belongsTo(User, { foreignKey: 'clientId', as: 'client' });
Coach.hasMany(Review, { foreignKey: 'coachId', as: 'reviews', onDelete: 'CASCADE' });
Review.belongsTo(Coach, { foreignKey: 'coachId', as: 'coach' });

// User <-> Notification
User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications', onDelete: 'CASCADE' });
Notification.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// User <-> Message
User.hasMany(Message, { foreignKey: 'senderId', as: 'sentMessages', onDelete: 'CASCADE' });
Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender' });
User.hasMany(Message, { foreignKey: 'recipientId', as: 'receivedMessages', onDelete: 'CASCADE' });
Message.belongsTo(User, { foreignKey: 'recipientId', as: 'recipient' });
Booking.hasMany(Message, { foreignKey: 'bookingId', as: 'messages', onDelete: 'CASCADE' });
Message.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' });

module.exports = {
  sequelize,
  Role,
  User,
  Coach,
  ClientProfile,
  SportCategory,
  CoachSpecialization,
  Availability,
  TimeSlot,
  Booking,
  Payment,
  Review,
  Notification,
  Message,
  Court,
};
